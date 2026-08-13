import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber, money } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

function calcPayroll(emp, leaveDays = 0) {
  const basic = money(emp.basicSalary);
  const hra = money(emp.hra);
  const conveyance = money(emp.conveyance);
  const otherAllow = money(emp.otherAllow);
  const overtime = 0;
  const gross = basic + hra + conveyance + otherAllow + overtime;
  const pf = Number(((basic * money(emp.pfPercent || 12)) / 100).toFixed(2));
  const professionalTax = basic > 15000 ? 200 : 0;
  const esi = basic <= 21000 ? Number(((gross * 0.75) / 100).toFixed(2)) : 0;
  const perDay = basic / 30;
  const leaveDeduction = Number((perDay * leaveDays).toFixed(2));
  const otherDeduction = 0;
  const totalDeductions = pf + professionalTax + esi + leaveDeduction + otherDeduction;
  const net = Number((gross - totalDeductions).toFixed(2));
  return {
    basicSalary: basic,
    hra,
    conveyance,
    overtime,
    otherAllow,
    pf,
    professionalTax,
    esi,
    leaveDeduction,
    otherDeduction,
    grossEarnings: gross,
    totalDeductions,
    netSalary: net,
  };
}

router.get('/', authRequired, async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const month = parseInt(req.query.month || String(new Date().getMonth() + 1), 10);
  const year = parseInt(req.query.year || String(new Date().getFullYear()), 10);
  const where = { month, year };
  if (req.query.status) where.status = req.query.status;

  const [total, items] = await Promise.all([
    prisma.payroll.count({ where }),
    prisma.payroll.findMany({
      where,
      include: { employee: { include: { department: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const all = await prisma.payroll.findMany({ where: { month, year } });
  const summary = {
    totalEmployees: all.length,
    paidEmployees: all.filter((p) => p.status === 'PAID').length,
    pendingPayments: all.filter((p) => p.status !== 'PAID').length,
    totalPayout: all.reduce((s, p) => s + money(p.netSalary), 0),
    averageSalary: all.length ? all.reduce((s, p) => s + money(p.netSalary), 0) / all.length : 0,
    month,
    year,
  };

  return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit), summary });
});

router.get('/:id', authRequired, async (req, res) => {
  const payroll = await prisma.payroll.findUnique({
    where: { id: req.params.id },
    include: { employee: { include: { department: true } } },
  });
  if (!payroll) return fail(res, 404, 'Payslip not found');
  return ok(res, decimalToNumber(payroll));
});

router.post('/generate', authRequired, async (req, res) => {
  try {
    const month = parseInt(req.body.month || String(new Date().getMonth() + 1), 10);
    const year = parseInt(req.body.year || String(new Date().getFullYear()), 10);
    const employees = await prisma.employee.findMany({ where: { status: 'ACTIVE' } });

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);

    const created = [];
    for (const emp of employees) {
      const leaveDays = await prisma.attendance.count({
        where: {
          employeeId: emp.id,
          date: { gte: start, lte: end },
          status: { in: ['ABSENT', 'ON_LEAVE'] },
        },
      });
      const calc = calcPayroll(emp, leaveDays);
      const row = await prisma.payroll.upsert({
        where: { employeeId_month_year: { employeeId: emp.id, month, year } },
        update: { ...calc, status: 'PROCESSED' },
        create: { employeeId: emp.id, month, year, ...calc, status: 'PROCESSED' },
        include: { employee: true },
      });
      created.push(row);
    }
    return ok(res, decimalToNumber(created));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.patch('/pay-all', authRequired, async (req, res) => {
  const month = parseInt(req.body.month || String(new Date().getMonth() + 1), 10);
  const year = parseInt(req.body.year || String(new Date().getFullYear()), 10);
  await prisma.payroll.updateMany({
    where: { month, year, status: { not: 'PAID' } },
    data: { status: 'PAID', paidAt: new Date() },
  });
  return ok(res, { message: 'All payroll marked paid' });
});

router.patch('/:id/pay', authRequired, async (req, res) => {
  const payroll = await prisma.payroll.update({
    where: { id: req.params.id },
    data: { status: 'PAID', paidAt: new Date() },
    include: { employee: true },
  });
  return ok(res, decimalToNumber(payroll));
});

export default router;
