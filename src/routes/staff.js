import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, money, decimalToNumber } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

function monthRange(month, year) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function isManagerOrAdmin(user) {
  const role = user?.role?.name;
  const perms = user?.role?.permissions || [];
  return role === 'Admin' || role === 'Manager' || perms.includes('*') || perms.includes('hr.*');
}

/** Aggregate sales for a user in a month (non-cancelled orders) */
async function salesForUser(userId, month, year) {
  const { start, end } = monthRange(month, year);
  const orders = await prisma.order.findMany({
    where: {
      assignedStaffId: userId,
      status: { not: 'CANCELLED' },
      orderDate: { gte: start, lte: end },
    },
    include: {
      customer: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { orderDate: 'desc' },
  });
  const salesAmount = orders.reduce((s, o) => s + money(o.totalAmount), 0);
  const paidAmount = orders
    .filter((o) => o.paymentStatus === 'PAID')
    .reduce((s, o) => s + money(o.totalAmount), 0);
  return {
    salesCount: orders.length,
    salesAmount,
    paidAmount,
    orders: decimalToNumber(orders),
  };
}

/** Staff: my sales + my bonuses */
router.get('/me', authRequired, async (req, res) => {
  const month = parseInt(req.query.month || String(new Date().getMonth() + 1), 10);
  const year = parseInt(req.query.year || String(new Date().getFullYear()), 10);

  const sales = await salesForUser(req.user.id, month, year);
  const employee = req.user.employee
    ? await prisma.employee.findUnique({
        where: { id: req.user.employee.id },
        include: { department: true },
      })
    : null;

  let bonus = null;
  if (employee) {
    bonus = await prisma.staffBonus.findUnique({
      where: { employeeId_month_year: { employeeId: employee.id, month, year } },
      include: { reviewedBy: { select: { id: true, name: true } } },
    });
  }

  const openTickets = await prisma.ticket.count({
    where: {
      assignedToId: req.user.id,
      status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING'] },
    },
  });

  return ok(res, {
    month,
    year,
    employee: decimalToNumber(employee),
    sales,
    bonus: decimalToNumber(bonus),
    openTickets,
  });
});

/** Admin/Manager: sales leaderboard + bonus status for all staff with user accounts */
router.get('/sales-review', authRequired, async (req, res) => {
  if (!isManagerOrAdmin(req.user)) return fail(res, 403, 'Managers only');

  const month = parseInt(req.query.month || String(new Date().getMonth() + 1), 10);
  const year = parseInt(req.query.year || String(new Date().getFullYear()), 10);
  const { start, end } = monthRange(month, year);

  const employees = await prisma.employee.findMany({
    where: { status: 'ACTIVE', userId: { not: null } },
    include: { user: { include: { role: true } }, department: true },
    orderBy: { firstName: 'asc' },
  });

  const rows = [];
  for (const emp of employees) {
    const orders = await prisma.order.findMany({
      where: {
        assignedStaffId: emp.userId,
        status: { not: 'CANCELLED' },
        orderDate: { gte: start, lte: end },
      },
    });
    const salesCount = orders.length;
    const salesAmount = orders.reduce((s, o) => s + money(o.totalAmount), 0);
    const paidAmount = orders
      .filter((o) => o.paymentStatus === 'PAID')
      .reduce((s, o) => s + money(o.totalAmount), 0);

    const bonus = await prisma.staffBonus.findUnique({
      where: { employeeId_month_year: { employeeId: emp.id, month, year } },
      include: { reviewedBy: { select: { id: true, name: true } } },
    });

    rows.push({
      employee: decimalToNumber(emp),
      salesCount,
      salesAmount,
      paidAmount,
      bonus: decimalToNumber(bonus),
    });
  }

  rows.sort((a, b) => b.salesAmount - a.salesAmount);
  return ok(res, { month, year, rows });
});

/**
 * Create/update sales review + bonus.
 * Body: employeeId, month, year, rating, bonusPercent OR bonusAmount, reviewNotes, status
 * If bonusPercent given, bonusAmount = paidAmount * percent/100 (uses paid sales by default)
 */
router.post('/bonuses', authRequired, async (req, res) => {
  if (!isManagerOrAdmin(req.user)) return fail(res, 403, 'Managers only');
  try {
    const month = parseInt(req.body.month || String(new Date().getMonth() + 1), 10);
    const year = parseInt(req.body.year || String(new Date().getFullYear()), 10);
    const { employeeId, rating = 0, reviewNotes, status = 'DRAFT' } = req.body;
    if (!employeeId) return fail(res, 400, 'employeeId required');

    const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp?.userId) return fail(res, 400, 'Employee must have a login linked for sales attribution');

    const sales = await salesForUser(emp.userId, month, year);
    let bonusPercent = money(req.body.bonusPercent);
    let bonusAmount = money(req.body.bonusAmount);

    if (req.body.bonusPercent != null && req.body.bonusAmount == null) {
      bonusAmount = Number(((sales.paidAmount * bonusPercent) / 100).toFixed(2));
    } else if (req.body.bonusAmount != null && req.body.bonusPercent == null && sales.paidAmount > 0) {
      bonusPercent = Number(((bonusAmount / sales.paidAmount) * 100).toFixed(2));
    }

    const row = await prisma.staffBonus.upsert({
      where: { employeeId_month_year: { employeeId, month, year } },
      update: {
        salesCount: sales.salesCount,
        salesAmount: sales.salesAmount,
        rating: money(rating),
        bonusPercent,
        bonusAmount,
        reviewNotes,
        status,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
      create: {
        employeeId,
        month,
        year,
        salesCount: sales.salesCount,
        salesAmount: sales.salesAmount,
        rating: money(rating),
        bonusPercent,
        bonusAmount,
        reviewNotes,
        status,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
      include: {
        employee: true,
        reviewedBy: { select: { id: true, name: true } },
      },
    });

    return ok(res, decimalToNumber(row));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

/** Apply all APPROVED bonuses for month into payroll.bonus and recalc net */
router.post('/bonuses/apply-payroll', authRequired, async (req, res) => {
  if (!isManagerOrAdmin(req.user)) return fail(res, 403, 'Managers only');
  try {
    const month = parseInt(req.body.month || String(new Date().getMonth() + 1), 10);
    const year = parseInt(req.body.year || String(new Date().getFullYear()), 10);

    const bonuses = await prisma.staffBonus.findMany({
      where: { month, year, status: 'APPROVED' },
    });

    const updated = [];
    for (const b of bonuses) {
      const payroll = await prisma.payroll.findUnique({
        where: { employeeId_month_year: { employeeId: b.employeeId, month, year } },
      });
      if (!payroll) continue;

      const bonus = money(b.bonusAmount);
      const basic = money(payroll.basicSalary);
      const hra = money(payroll.hra);
      const conveyance = money(payroll.conveyance);
      const overtime = money(payroll.overtime);
      const otherAllow = money(payroll.otherAllow);
      const gross = basic + hra + conveyance + otherAllow + overtime + bonus;
      const totalDeductions = money(payroll.totalDeductions);
      const net = Number((gross - totalDeductions).toFixed(2));

      const row = await prisma.payroll.update({
        where: { id: payroll.id },
        data: { bonus, grossEarnings: gross, netSalary: net },
        include: { employee: true },
      });

      await prisma.staffBonus.update({
        where: { id: b.id },
        data: { status: 'PAID' },
      });

      updated.push(row);
    }

    return ok(res, decimalToNumber(updated));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
