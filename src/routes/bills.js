import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber, genNo, money } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

function calcTotals(items, taxPercent = 0, discount = 0) {
  const subtotal = items.reduce((s, i) => s + money(i.unitCost) * Number(i.quantity || 0), 0);
  const taxAmount = (subtotal * money(taxPercent)) / 100;
  const totalAmount = Math.max(0, subtotal + taxAmount - money(discount));
  return { subtotal, taxAmount, totalAmount };
}

const includeDetail = {
  supplier: true,
  purchase: { select: { id: true, purchaseNo: true } },
  createdBy: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true, costPrice: true } } } },
};

async function applyStockIn(tx, bill, userId) {
  for (const item of bill.items) {
    if (!item.productId) continue;
    await tx.product.update({
      where: { id: item.productId },
      data: {
        stock: { increment: item.quantity },
        costPrice: item.unitCost,
        status: 'PUBLISHED',
        history: {
          create: {
            action: 'STOCK_IN',
            note: `Bill ${bill.billNo}: +${item.quantity}`,
            userId,
          },
        },
      },
    });
  }
}

async function reverseStock(tx, bill, userId) {
  for (const item of bill.items) {
    if (!item.productId) continue;
    await tx.product.update({
      where: { id: item.productId },
      data: {
        stock: { decrement: item.quantity },
        history: {
          create: {
            action: 'STOCK_OUT',
            note: `Bill ${bill.billNo} reversed: -${item.quantity}`,
            userId,
          },
        },
      },
    });
  }
}

router.get('/', authRequired, async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.supplierId) where.supplierId = req.query.supplierId;
  if (req.query.search) {
    where.OR = [
      { billNo: { contains: req.query.search, mode: 'insensitive' } },
      { supplier: { name: { contains: req.query.search, mode: 'insensitive' } } },
    ];
  }
  const [total, items] = await Promise.all([
    prisma.bill.count({ where }),
    prisma.bill.findMany({
      where,
      include: includeDetail,
      orderBy: { billDate: 'desc' },
      skip,
      take: limit,
    }),
  ]);
  return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) });
});

router.get('/:id', authRequired, async (req, res) => {
  const bill = await prisma.bill.findUnique({
    where: { id: req.params.id },
    include: includeDetail,
  });
  if (!bill) return fail(res, 404, 'Bill not found');
  return ok(res, decimalToNumber(bill));
});

/** Admin creates bill with multiple products from one supplier */
router.post('/', authRequired, async (req, res) => {
  try {
    const {
      supplierId,
      purchaseId,
      items,
      notes,
      status = 'RECEIVED',
      taxPercent = 0,
      discount = 0,
      dueDate,
      billDate,
      paymentStatus,
      applyStock = true,
    } = req.body;

    let resolvedSupplierId = supplierId;
    let lineItems = items;

    if (purchaseId) {
      const purchase = await prisma.purchase.findUnique({
        where: { id: purchaseId },
        include: { items: { include: { product: true } }, bills: true },
      });
      if (!purchase) return fail(res, 404, 'Purchase not found');
      if (purchase.bills?.length) return fail(res, 400, 'Bill already exists for this purchase');
      resolvedSupplierId = purchase.supplierId;
      if (!lineItems?.length) {
        lineItems = purchase.items.map((i) => ({
          productId: i.productId,
          description: i.product?.name,
          quantity: i.quantity,
          unitCost: money(i.unitCost),
        }));
      }
    }

    if (!resolvedSupplierId || !lineItems?.length) {
      return fail(res, 400, 'supplier and at least one line item required');
    }

    const mapped = lineItems.map((i) => {
      const qty = Number(i.quantity || 1);
      const unitCost = money(i.unitCost);
      return {
        productId: i.productId || null,
        description: i.description || null,
        quantity: qty,
        unitCost,
        total: unitCost * qty,
      };
    });

    const { subtotal, taxAmount, totalAmount } = calcTotals(mapped, taxPercent, discount);
    const shouldStock = applyStock && status === 'RECEIVED' && !purchaseId;

    const bill = await prisma.$transaction(async (tx) => {
      const created = await tx.bill.create({
        data: {
          billNo: genNo('BILL'),
          supplierId: resolvedSupplierId,
          purchaseId: purchaseId || null,
          status,
          paymentStatus: paymentStatus || (status === 'PAID' ? 'PAID' : 'PENDING'),
          subtotal,
          taxPercent: money(taxPercent),
          taxAmount,
          discount: money(discount),
          totalAmount,
          notes,
          dueDate: dueDate ? new Date(dueDate) : null,
          billDate: billDate ? new Date(billDate) : new Date(),
          stockApplied: shouldStock,
          createdById: req.user.id,
          items: { create: mapped },
        },
        include: includeDetail,
      });

      if (shouldStock) {
        await applyStockIn(tx, created, req.user.id);
      }

      return created;
    });

    return ok(res, decimalToNumber(bill));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    const existing = await prisma.bill.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!existing) return fail(res, 404, 'Bill not found');

    const nextStatus = req.body.status;
    const bill = await prisma.$transaction(async (tx) => {
      let stockApplied = existing.stockApplied;

      if (nextStatus === 'RECEIVED' && !existing.stockApplied && !existing.purchaseId) {
        await applyStockIn(tx, existing, req.user.id);
        stockApplied = true;
      }
      if (nextStatus === 'CANCELLED' && existing.stockApplied) {
        await reverseStock(tx, existing, req.user.id);
        stockApplied = false;
      }

      const data = { stockApplied };
      if (nextStatus) data.status = nextStatus;
      if (req.body.paymentStatus) data.paymentStatus = req.body.paymentStatus;
      if (req.body.notes !== undefined) data.notes = req.body.notes;
      if (req.body.dueDate !== undefined) data.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
      if (nextStatus === 'PAID') data.paymentStatus = 'PAID';

      return tx.bill.update({
        where: { id: req.params.id },
        data,
        include: includeDetail,
      });
    });

    return ok(res, decimalToNumber(bill));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const existing = await prisma.bill.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!existing) return fail(res, 404, 'Bill not found');
    if (existing.status === 'PAID') return fail(res, 400, 'Cannot delete a paid bill');

    await prisma.$transaction(async (tx) => {
      if (existing.stockApplied) {
        await reverseStock(tx, existing, req.user.id);
      }
      await tx.billItem.deleteMany({ where: { billId: existing.id } });
      await tx.bill.delete({ where: { id: existing.id } });
    });

    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
