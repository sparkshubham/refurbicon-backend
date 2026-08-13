import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber, genNo } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.search) {
    where.OR = [
      { paymentNo: { contains: req.query.search, mode: 'insensitive' } },
      { reference: { contains: req.query.search, mode: 'insensitive' } },
      { customer: { name: { contains: req.query.search, mode: 'insensitive' } } },
      { order: { orderNo: { contains: req.query.search, mode: 'insensitive' } } },
    ];
  }
  const [total, items] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: { customer: true, order: true },
      orderBy: { paidAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);
  return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) });
});

router.get('/:id', authRequired, async (req, res) => {
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: { customer: true, order: true },
  });
  if (!payment) return fail(res, 404, 'Payment not found');
  return ok(res, decimalToNumber(payment));
});

router.post('/', authRequired, async (req, res) => {
  try {
    const { orderId, customerId, amount, method, reference, status = 'PAID' } = req.body;
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          paymentNo: genNo('PAY'),
          orderId,
          customerId,
          amount,
          method,
          reference,
          status,
        },
      });
      if (orderId && status === 'PAID') {
        await tx.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: 'PAID',
            status: 'PAYMENT_RECEIVED',
            paymentMethod: method,
            statusLogs: {
              create: { status: 'PAYMENT_RECEIVED', note: `Payment ${created.paymentNo}`, userId: req.user.id },
            },
          },
        });
      }
      return created;
    });
    return ok(res, decimalToNumber(payment));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.put('/:id', authRequired, async (req, res) => {
  try {
    const { amount, method, reference, status } = req.body;
    const payment = await prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: req.params.id },
        data: {
          ...(amount != null ? { amount } : {}),
          ...(method ? { method } : {}),
          ...(reference !== undefined ? { reference } : {}),
          ...(status ? { status } : {}),
        },
        include: { customer: true, order: true },
      });

      if (updated.orderId && status === 'PAID') {
        await tx.order.update({
          where: { id: updated.orderId },
          data: { paymentStatus: 'PAID' },
        });
      }
      if (updated.orderId && (status === 'FAILED' || status === 'REFUNDED')) {
        await tx.order.update({
          where: { id: updated.orderId },
          data: { paymentStatus: status === 'REFUNDED' ? 'REFUNDED' : 'PENDING' },
        });
      }
      return updated;
    });
    return ok(res, decimalToNumber(payment));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const payment = await prisma.payment.update({
      where: { id: req.params.id },
      data: { status: 'REFUNDED' },
    });
    if (payment.orderId) {
      await prisma.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: 'REFUNDED' },
      });
    }
    return ok(res, decimalToNumber(payment));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
