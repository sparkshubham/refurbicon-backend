import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req.query);
    const { search } = req.query;
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        include: { _count: { select: { orders: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return ok(res, items, { page, limit, total, pages: Math.ceil(total / limit) });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.get('/:id', authRequired, async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { id: req.params.id },
    include: {
      orders: { orderBy: { orderDate: 'desc' }, take: 20 },
      payments: { orderBy: { paidAt: 'desc' }, take: 20 },
    },
  });
  if (!customer) return fail(res, 404, 'Customer not found');
  return ok(res, decimalToNumber(customer));
});

router.post('/', authRequired, async (req, res) => {
  try {
    const customer = await prisma.customer.create({ data: req.body });
    return ok(res, customer);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.put('/:id', authRequired, async (req, res) => {
  try {
    const customer = await prisma.customer.update({ where: { id: req.params.id }, data: req.body });
    return ok(res, customer);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  await prisma.customer.update({ where: { id: req.params.id }, data: { isActive: false } });
  return ok(res, { deleted: true });
});

export default router;
