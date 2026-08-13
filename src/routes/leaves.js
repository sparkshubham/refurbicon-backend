import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.employeeId) where.employeeId = req.query.employeeId;
  const [total, items] = await Promise.all([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.findMany({
      where,
      include: { employee: { include: { department: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);
  return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) });
});

router.post('/', authRequired, async (req, res) => {
  try {
    const employeeId = req.body.employeeId || req.user.employee?.id;
    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveType: req.body.leaveType || 'Casual',
        startDate: new Date(req.body.startDate),
        endDate: new Date(req.body.endDate),
        reason: req.body.reason,
      },
      include: { employee: true },
    });
    return ok(res, decimalToNumber(leave));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.patch('/:id/status', authRequired, async (req, res) => {
  try {
    const { status } = req.body;
    const leave = await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data: { status },
      include: { employee: true },
    });

    if (status === 'APPROVED') {
      const start = new Date(leave.startDate);
      const end = new Date(leave.endDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const date = new Date(d);
        date.setHours(0, 0, 0, 0);
        await prisma.attendance.upsert({
          where: { employeeId_date: { employeeId: leave.employeeId, date } },
          update: { status: 'ON_LEAVE' },
          create: { employeeId: leave.employeeId, date, status: 'ON_LEAVE' },
        });
      }
    }
    return ok(res, decimalToNumber(leave));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.put('/:id', authRequired, async (req, res) => {
  try {
    const leave = await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data: {
        leaveType: req.body.leaveType,
        startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
        reason: req.body.reason,
        ...(req.body.employeeId ? { employeeId: req.body.employeeId } : {}),
      },
      include: { employee: true },
    });
    return ok(res, decimalToNumber(leave));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED' },
    });
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
