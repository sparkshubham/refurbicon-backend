import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

function todayDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function hoursBetween(a, b) {
  if (!a || !b) return null;
  return Number(((b - a) / 3600000).toFixed(2));
}

router.get('/today', authRequired, async (req, res) => {
  try {
    const date = todayDate();
    const where = { date };
    if (req.query.departmentId) {
      where.employee = { departmentId: req.query.departmentId };
    }
    const records = await prisma.attendance.findMany({
      where,
      include: {
        employee: { include: { department: true } },
      },
      orderBy: { checkIn: 'asc' },
    });

    const employees = await prisma.employee.findMany({
      where: { status: 'ACTIVE', ...(req.query.departmentId ? { departmentId: req.query.departmentId } : {}) },
      include: { department: true },
    });

    const byEmp = Object.fromEntries(records.map((r) => [r.employeeId, r]));
    const merged = employees.map((emp) => {
      const rec = byEmp[emp.id];
      return (
        rec || {
          id: null,
          employeeId: emp.id,
          employee: emp,
          date,
          checkIn: null,
          checkOut: null,
          status: 'ABSENT',
          workingHours: null,
        }
      );
    });

    const stats = {
      present: merged.filter((r) => r.status === 'PRESENT').length,
      late: merged.filter((r) => r.status === 'LATE').length,
      absent: merged.filter((r) => r.status === 'ABSENT').length,
      onLeave: merged.filter((r) => r.status === 'ON_LEAVE').length,
      total: merged.length,
    };

    return ok(res, decimalToNumber(merged), { stats });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.get('/', authRequired, async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.employeeId) where.employeeId = req.query.employeeId;
  if (req.query.status) where.status = req.query.status;
  if (req.query.from || req.query.to) {
    where.date = {};
    if (req.query.from) where.date.gte = new Date(req.query.from);
    if (req.query.to) where.date.lte = new Date(req.query.to);
  }
  const [total, items] = await Promise.all([
    prisma.attendance.count({ where }),
    prisma.attendance.findMany({
      where,
      include: { employee: { include: { department: true } } },
      orderBy: [{ date: 'desc' }, { checkIn: 'desc' }],
      skip,
      take: limit,
    }),
  ]);
  return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) });
});

router.get('/my', authRequired, async (req, res) => {
  const employee = req.user.employee;
  if (!employee) return fail(res, 400, 'No employee profile linked');
  const date = todayDate();
  const today = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date } },
  });
  const history = await prisma.attendance.findMany({
    where: { employeeId: employee.id },
    orderBy: { date: 'desc' },
    take: 30,
  });
  return ok(res, {
    employee: decimalToNumber(employee),
    today: decimalToNumber(today),
    history: decimalToNumber(history),
  });
});

router.post('/check-in', authRequired, async (req, res) => {
  try {
    const employeeId = req.body.employeeId || req.user.employee?.id;
    if (!employeeId) return fail(res, 400, 'Employee required');
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return fail(res, 404, 'Employee not found');

    const date = todayDate();
    const now = new Date();
    const [h, m] = (employee.shiftStart || '09:00').split(':').map(Number);
    const shiftStart = new Date(date);
    shiftStart.setHours(h, m, 0, 0);
    const lateThreshold = new Date(shiftStart.getTime() + 15 * 60000);
    const status = now > lateThreshold ? 'LATE' : 'PRESENT';

    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date } },
      update: {
        checkIn: now,
        status,
        faceMatched: !!req.body.faceMatched,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        note: req.body.note,
      },
      create: {
        employeeId,
        date,
        checkIn: now,
        status,
        faceMatched: !!req.body.faceMatched,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        note: req.body.note,
      },
      include: { employee: true },
    });
    return ok(res, decimalToNumber(record));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.post('/check-out', authRequired, async (req, res) => {
  try {
    const employeeId = req.body.employeeId || req.user.employee?.id;
    if (!employeeId) return fail(res, 400, 'Employee required');
    const date = todayDate();
    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date } },
    });
    if (!existing?.checkIn) return fail(res, 400, 'Check-in required first');

    const now = new Date();
    const record = await prisma.attendance.update({
      where: { id: existing.id },
      data: {
        checkOut: now,
        workingHours: hoursBetween(existing.checkIn, now),
      },
      include: { employee: true },
    });
    return ok(res, decimalToNumber(record));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.post('/mark', authRequired, async (req, res) => {
  try {
    const { employeeId, date: dateStr, status, note } = req.body;
    const date = dateStr ? new Date(dateStr) : todayDate();
    date.setHours(0, 0, 0, 0);
    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date } },
      update: { status, note },
      create: { employeeId, date, status, note },
      include: { employee: true },
    });
    return ok(res, decimalToNumber(record));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
