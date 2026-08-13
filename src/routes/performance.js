import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req.query);
    const where = {};
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.search) {
      where.OR = [
        { period: { contains: req.query.search, mode: 'insensitive' } },
        { employee: { firstName: { contains: req.query.search, mode: 'insensitive' } } },
        { employee: { lastName: { contains: req.query.search, mode: 'insensitive' } } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.performance.count({ where }),
      prisma.performance.findMany({
        where,
        include: { employee: { include: { department: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) || 1 });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.get('/:id', authRequired, async (req, res) => {
  const perf = await prisma.performance.findUnique({
    where: { id: req.params.id },
    include: { employee: { include: { department: true } } },
  });
  if (!perf) return fail(res, 404, 'Review not found');
  return ok(res, decimalToNumber(perf));
});

router.post('/', authRequired, async (req, res) => {
  try {
    const perf = await prisma.performance.create({
      data: {
        employeeId: req.body.employeeId,
        period: req.body.period,
        rating: req.body.rating,
        goals: req.body.goals,
        feedback: req.body.feedback,
        reviewedBy: req.user.name,
      },
      include: { employee: true },
    });
    return ok(res, decimalToNumber(perf));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.put('/:id', authRequired, async (req, res) => {
  try {
    const perf = await prisma.performance.update({
      where: { id: req.params.id },
      data: {
        period: req.body.period,
        rating: req.body.rating,
        goals: req.body.goals,
        feedback: req.body.feedback,
        reviewedBy: req.body.reviewedBy || req.user.name,
        ...(req.body.employeeId ? { employeeId: req.body.employeeId } : {}),
      },
      include: { employee: true },
    });
    return ok(res, decimalToNumber(perf));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    await prisma.performance.delete({ where: { id: req.params.id } });
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
