import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber, money } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const start = new Date();
  start.setMonth(start.getMonth() - 1);
  const orders = await prisma.order.findMany({
    where: { orderDate: { gte: start }, status: { not: 'CANCELLED' } },
    include: { customer: true, items: true },
    orderBy: { orderDate: 'desc' },
    skip,
    take: limit,
  });
  const total = await prisma.order.count({
    where: { orderDate: { gte: start }, status: { not: 'CANCELLED' } },
  });
  const revenue = orders.reduce((s, o) => s + money(o.totalAmount), 0);
  return ok(res, decimalToNumber(orders), { page, limit, total, pages: Math.ceil(total / limit), revenue });
});

router.get('/summary', authRequired, async (_req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT DATE("orderDate") AS day, COUNT(*)::int AS orders, COALESCE(SUM("totalAmount"),0)::float AS revenue
    FROM "Order"
    WHERE "orderDate" >= NOW() - INTERVAL '30 days' AND status != 'CANCELLED'
    GROUP BY 1 ORDER BY 1
  `;
  return ok(res, rows.map((r) => ({ day: r.day, orders: r.orders, revenue: Number(r.revenue) })));
});

export default router;
