import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, money } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (_req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const yesterdayStart = new Date(start);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(end);
    yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);

    const [
      todayOrders,
      yesterdayOrders,
      pendingOrders,
      totalProducts,
      outOfStock,
      totalCustomers,
      products,
      employees,
      todayAttendance,
      salesByMonth,
      lowStockRows,
    ] = await Promise.all([
      prisma.order.findMany({
        where: { orderDate: { gte: start, lte: end }, status: { not: 'CANCELLED' } },
        select: { totalAmount: true },
      }),
      prisma.order.findMany({
        where: { orderDate: { gte: yesterdayStart, lte: yesterdayEnd }, status: { not: 'CANCELLED' } },
        select: { totalAmount: true },
      }),
      prisma.order.count({
        where: { status: { in: ['PLACED', 'PAYMENT_RECEIVED', 'CONFIRMED', 'PROCESSING'] } },
      }),
      prisma.product.count(),
      prisma.product.count({ where: { stock: 0 } }),
      prisma.customer.count({ where: { isActive: true } }),
      prisma.product.findMany({ select: { stock: true, price: true, costPrice: true } }),
      prisma.employee.count({ where: { status: 'ACTIVE' } }),
      prisma.attendance.findMany({
        where: { date: start },
        select: { status: true },
      }),
      prisma.$queryRaw`
        SELECT TO_CHAR("orderDate", 'Mon') AS month,
               EXTRACT(MONTH FROM "orderDate") AS m,
               COALESCE(SUM("totalAmount"), 0)::float AS total
        FROM "Order"
        WHERE "orderDate" >= NOW() - INTERVAL '6 months'
          AND status != 'CANCELLED'
        GROUP BY 1, 2
        ORDER BY 2
      `,
      prisma.$queryRaw`SELECT COUNT(*)::int AS c FROM "Product" WHERE stock > 0 AND stock <= "lowStockAt"`,
    ]);

    const todaySales = todayOrders.reduce((s, o) => s + money(o.totalAmount), 0);
    const yesterdaySales = yesterdayOrders.reduce((s, o) => s + money(o.totalAmount), 0);
    const salesChange = yesterdaySales === 0 ? 100 : ((todaySales - yesterdaySales) / yesterdaySales) * 100;
    const stockValue = products.reduce((s, p) => s + p.stock * money(p.costPrice || p.price), 0);
    const lowStockCount = lowStockRows[0]?.c || 0;

    const present = todayAttendance.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
    const absent = todayAttendance.filter((a) => a.status === 'ABSENT').length;
    const onLeave = todayAttendance.filter((a) => a.status === 'ON_LEAVE').length;
    const late = todayAttendance.filter((a) => a.status === 'LATE').length;

    return ok(res, {
      kpis: {
        todaySales,
        salesChange: Number(salesChange.toFixed(1)),
        todayOrders: todayOrders.length,
        pendingOrders,
        totalProducts,
        lowStock: lowStockCount,
        outOfStock,
        totalCustomers,
        stockValue,
      },
      salesOverview: salesByMonth.map((r) => ({ month: r.month, total: Number(r.total) })),
      hr: {
        totalEmployees: employees,
        present,
        absent,
        onLeave,
        late,
      },
      attendanceOverview: [
        { name: 'Present', value: present, color: '#22c55e' },
        { name: 'Absent', value: absent, color: '#ef4444' },
        { name: 'On Leave', value: onLeave, color: '#f59e0b' },
      ],
    });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
