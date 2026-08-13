import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  const [total, items] = await Promise.all([
    prisma.delivery.count({ where }),
    prisma.delivery.findMany({
      where,
      include: {
        order: { include: { customer: true } },
        assignedTo: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);
  return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) });
});

router.patch('/:id', authRequired, async (req, res) => {
  const data = { ...req.body };
  if (data.status === 'DELIVERED') data.deliveredAt = new Date();
  const delivery = await prisma.delivery.update({
    where: { id: req.params.id },
    data,
    include: { order: true, assignedTo: { select: { id: true, name: true } } },
  });
  if (data.status === 'DELIVERED') {
    await prisma.order.update({
      where: { id: delivery.orderId },
      data: {
        status: 'DELIVERED',
        statusLogs: { create: { status: 'DELIVERED', note: 'Marked delivered', userId: req.user.id } },
      },
    });
  }
  return ok(res, decimalToNumber(delivery));
});

export default router;
