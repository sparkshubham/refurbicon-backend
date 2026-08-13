import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, money } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/business', authRequired, async (_req, res) => {
  try {
    const [orders, products, customers, payments] = await Promise.all([
      prisma.order.findMany({ where: { status: { not: 'CANCELLED' } }, select: { totalAmount: true, status: true, orderDate: true } }),
      prisma.product.findMany({ select: { stock: true, price: true, costPrice: true, status: true } }),
      prisma.customer.count({ where: { isActive: true } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'PAID' } }),
    ]);
    return ok(res, {
      totalRevenue: orders.reduce((s, o) => s + money(o.totalAmount), 0),
      totalOrders: orders.length,
      delivered: orders.filter((o) => o.status === 'DELIVERED').length,
      customers,
      paymentsCollected: money(payments._sum.amount),
      stockValue: products.reduce((s, p) => s + p.stock * money(p.costPrice || p.price), 0),
      products: products.length,
      outOfStock: products.filter((p) => p.stock === 0).length,
    });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.get('/hr', authRequired, async (_req, res) => {
  try {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    const [employees, attendance, leaves, payroll] = await Promise.all([
      prisma.employee.groupBy({ by: ['status'], _count: true }),
      prisma.attendance.groupBy({ by: ['status'], where: { date }, _count: true }),
      prisma.leaveRequest.groupBy({ by: ['status'], _count: true }),
      prisma.payroll.aggregate({
        _sum: { netSalary: true },
        where: { month: date.getMonth() + 1, year: date.getFullYear() },
      }),
    ]);
    return ok(res, {
      employees,
      attendanceToday: attendance,
      leaves,
      payrollThisMonth: money(payroll._sum.netSalary),
    });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
