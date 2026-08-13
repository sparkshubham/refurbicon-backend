import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber, genNo, money } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

function calcTotals(items, taxPercent = 0, discount = 0) {
  const subtotal = items.reduce((s, i) => s + money(i.unitPrice) * Number(i.quantity || 0), 0);
  const taxAmount = (subtotal * money(taxPercent)) / 100;
  const totalAmount = Math.max(0, subtotal + taxAmount - money(discount));
  return { subtotal, taxAmount, totalAmount };
}

const includeDetail = {
  customer: true,
  order: { select: { id: true, orderNo: true } },
  createdBy: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true, price: true } } } },
};

router.get('/', authRequired, async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.customerId) where.customerId = req.query.customerId;
  if (req.query.search) {
    where.OR = [
      { invoiceNo: { contains: req.query.search, mode: 'insensitive' } },
      { customer: { name: { contains: req.query.search, mode: 'insensitive' } } },
    ];
  }
  const [total, items] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      include: includeDetail,
      orderBy: { invoiceDate: 'desc' },
      skip,
      take: limit,
    }),
  ]);
  return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) });
});

router.get('/:id', authRequired, async (req, res) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: req.params.id },
    include: includeDetail,
  });
  if (!invoice) return fail(res, 404, 'Invoice not found');
  return ok(res, decimalToNumber(invoice));
});

/** Create standalone invoice OR from order */
router.post('/', authRequired, async (req, res) => {
  try {
    const {
      customerId,
      orderId,
      items,
      notes,
      status = 'ISSUED',
      taxPercent = 0,
      discount = 0,
      dueDate,
      invoiceDate,
      paymentStatus,
    } = req.body;

    let resolvedCustomerId = customerId;
    let lineItems = items;

    if (orderId) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { product: true } }, invoices: true },
      });
      if (!order) return fail(res, 404, 'Order not found');
      if (order.invoices?.length) return fail(res, 400, 'Invoice already exists for this order');
      resolvedCustomerId = order.customerId;
      if (!lineItems?.length) {
        lineItems = order.items.map((i) => ({
          productId: i.productId,
          description: i.product?.name,
          quantity: i.quantity,
          unitPrice: money(i.unitPrice),
        }));
      }
    }

    if (!resolvedCustomerId || !lineItems?.length) {
      return fail(res, 400, 'customer and at least one line item required');
    }

    const mapped = lineItems.map((i) => {
      const qty = Number(i.quantity || 1);
      const unitPrice = money(i.unitPrice);
      return {
        productId: i.productId || null,
        description: i.description || null,
        quantity: qty,
        unitPrice,
        total: unitPrice * qty,
      };
    });

    const { subtotal, taxAmount, totalAmount } = calcTotals(mapped, taxPercent, discount);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNo: genNo('INV'),
        customerId: resolvedCustomerId,
        orderId: orderId || null,
        status,
        paymentStatus: paymentStatus || (status === 'PAID' ? 'PAID' : 'PENDING'),
        subtotal,
        taxPercent: money(taxPercent),
        taxAmount,
        discount: money(discount),
        totalAmount,
        notes,
        dueDate: dueDate ? new Date(dueDate) : null,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
        createdById: req.user.id,
        items: { create: mapped },
      },
      include: includeDetail,
    });

    return ok(res, decimalToNumber(invoice));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    const existing = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!existing) return fail(res, 404, 'Invoice not found');

    const data = {};
    if (req.body.status) data.status = req.body.status;
    if (req.body.paymentStatus) data.paymentStatus = req.body.paymentStatus;
    if (req.body.notes !== undefined) data.notes = req.body.notes;
    if (req.body.dueDate !== undefined) data.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
    if (req.body.status === 'PAID') data.paymentStatus = 'PAID';

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data,
      include: includeDetail,
    });
    return ok(res, decimalToNumber(invoice));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const existing = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!existing) return fail(res, 404, 'Invoice not found');
    if (existing.status === 'PAID') return fail(res, 400, 'Cannot delete a paid invoice');
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: existing.id } });
    await prisma.invoice.delete({ where: { id: existing.id } });
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
