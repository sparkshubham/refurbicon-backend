import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber, genNo, money } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.search) {
    where.OR = [
      { purchaseNo: { contains: req.query.search, mode: 'insensitive' } },
      { supplier: { name: { contains: req.query.search, mode: 'insensitive' } } },
    ];
  }
  const [total, items] = await Promise.all([
    prisma.purchase.count({ where }),
    prisma.purchase.findMany({
      where,
      include: { supplier: true, items: { include: { product: true } } },
      orderBy: { purchaseDate: 'desc' },
      skip,
      take: limit,
    }),
  ]);
  return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) });
});

router.get('/suppliers', authRequired, async (_req, res) => {
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  return ok(res, suppliers);
});

router.post('/suppliers', authRequired, async (req, res) => {
  const supplier = await prisma.supplier.create({ data: req.body });
  return ok(res, supplier);
});

router.put('/suppliers/:id', authRequired, async (req, res) => {
  try {
    const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data: req.body });
    return ok(res, supplier);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.delete('/suppliers/:id', authRequired, async (req, res) => {
  try {
    await prisma.supplier.delete({ where: { id: req.params.id } });
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, 400, 'Cannot delete supplier with purchases');
  }
});

router.get('/:id', authRequired, async (req, res) => {
  const purchase = await prisma.purchase.findUnique({
    where: { id: req.params.id },
    include: { supplier: true, items: { include: { product: true } } },
  });
  if (!purchase) return fail(res, 404, 'Purchase not found');
  return ok(res, decimalToNumber(purchase));
});

router.post('/', authRequired, async (req, res) => {
  try {
    const { supplierId, items, notes, status = 'RECEIVED' } = req.body;
    if (!supplierId || !items?.length) return fail(res, 400, 'supplier and items required');

    let totalAmount = 0;
    const lineItems = items.map((i) => {
      const total = money(i.unitCost) * i.quantity;
      totalAmount += total;
      return { productId: i.productId, quantity: i.quantity, unitCost: i.unitCost, total };
    });

    const purchase = await prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          purchaseNo: genNo('PUR'),
          supplierId,
          status,
          totalAmount,
          notes,
          items: { create: lineItems },
        },
        include: { supplier: true, items: { include: { product: true } } },
      });

      if (status === 'RECEIVED') {
        for (const item of lineItems) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: { increment: item.quantity },
              costPrice: item.unitCost,
              status: 'PUBLISHED',
              history: {
                create: {
                  action: 'STOCK_IN',
                  note: `Purchase ${created.purchaseNo}: +${item.quantity}`,
                  userId: req.user.id,
                },
              },
            },
          });
        }
      }
      return created;
    });

    return ok(res, decimalToNumber(purchase));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    const existing = await prisma.purchase.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!existing) return fail(res, 404, 'Purchase not found');

    const nextStatus = req.body.status;
    const purchase = await prisma.$transaction(async (tx) => {
      if (nextStatus === 'CANCELLED' && existing.status === 'RECEIVED') {
        for (const item of existing.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: { decrement: item.quantity },
              history: {
                create: {
                  action: 'STOCK_OUT',
                  note: `Purchase ${existing.purchaseNo} cancelled: -${item.quantity}`,
                  userId: req.user.id,
                },
              },
            },
          });
        }
      }
      if (nextStatus === 'RECEIVED' && existing.status !== 'RECEIVED') {
        for (const item of existing.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: { increment: item.quantity },
              costPrice: item.unitCost,
              status: 'PUBLISHED',
              history: {
                create: {
                  action: 'STOCK_IN',
                  note: `Purchase ${existing.purchaseNo} received: +${item.quantity}`,
                  userId: req.user.id,
                },
              },
            },
          });
        }
      }

      return tx.purchase.update({
        where: { id: req.params.id },
        data: {
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
        },
        include: { supplier: true, items: { include: { product: true } } },
      });
    });

    return ok(res, decimalToNumber(purchase));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const existing = await prisma.purchase.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!existing) return fail(res, 404, 'Purchase not found');

    await prisma.$transaction(async (tx) => {
      if (existing.status === 'RECEIVED') {
        for (const item of existing.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: { decrement: item.quantity },
              history: {
                create: {
                  action: 'STOCK_OUT',
                  note: `Purchase ${existing.purchaseNo} deleted: -${item.quantity}`,
                  userId: req.user.id,
                },
              },
            },
          });
        }
      }
      await tx.purchaseItem.deleteMany({ where: { purchaseId: existing.id } });
      await tx.purchase.delete({ where: { id: existing.id } });
    });

    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
