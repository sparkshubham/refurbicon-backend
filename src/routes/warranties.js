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
      { warrantyNo: { contains: req.query.search, mode: 'insensitive' } },
      { customerName: { contains: req.query.search, mode: 'insensitive' } },
      { serialNo: { contains: req.query.search, mode: 'insensitive' } },
    ];
  }
  const [total, items] = await Promise.all([
    prisma.warranty.count({ where }),
    prisma.warranty.findMany({
      where,
      include: { product: true, order: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);
  return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) });
});

router.post('/', authRequired, async (req, res) => {
  try {
    const { productId, orderId, customerName, serialNo, months = 6, notes } = req.body;
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);
    const warranty = await prisma.warranty.create({
      data: {
        warrantyNo: genNo('WRN'),
        productId,
        orderId,
        customerName,
        serialNo,
        endDate,
        notes,
      },
      include: { product: true },
    });
    return ok(res, decimalToNumber(warranty));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  const warranty = await prisma.warranty.update({
    where: { id: req.params.id },
    data: req.body,
    include: { product: true },
  });
  return ok(res, decimalToNumber(warranty));
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    await prisma.warranty.delete({ where: { id: req.params.id } });
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
