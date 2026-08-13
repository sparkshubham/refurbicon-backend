import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber } from '../lib/helpers.js';
import { authRequired, requirePermission } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, requirePermission('users.manage', '*'), async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.search) {
    where.OR = [
      { name: { contains: req.query.search, mode: 'insensitive' } },
      { email: { contains: req.query.search, mode: 'insensitive' } },
    ];
  }
  if (req.query.isActive === 'true') where.isActive = true;
  if (req.query.isActive === 'false') where.isActive = false;
  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: { role: true, employee: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);
  const safe = items.map(({ passwordHash, ...u }) => u);
  return ok(res, decimalToNumber(safe), { page, limit, total, pages: Math.ceil(total / limit) });
});

router.post('/', authRequired, requirePermission('users.manage', '*'), async (req, res) => {
  try {
    const passwordHash = await bcrypt.hash(req.body.password || 'changeme123', 10);
    const user = await prisma.user.create({
      data: {
        email: req.body.email.toLowerCase(),
        passwordHash,
        name: req.body.name,
        phone: req.body.phone,
        roleId: req.body.roleId,
        isActive: req.body.isActive !== false,
      },
      include: { role: true },
    });
    const { passwordHash: _, ...safe } = user;
    return ok(res, safe);
  } catch (e) {
    if (e.code === 'P2002') return fail(res, 400, 'Email already exists');
    return fail(res, 500, e.message);
  }
});

router.put('/:id', authRequired, requirePermission('users.manage', '*'), async (req, res) => {
  const data = { ...req.body };
  delete data.password;
  delete data.passwordHash;
  if (req.body.password) data.passwordHash = await bcrypt.hash(req.body.password, 10);
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
    include: { role: true },
  });
  const { passwordHash, ...safe } = user;
  return ok(res, safe);
});

router.delete('/:id', authRequired, requirePermission('users.manage', '*'), async (req, res) => {
  await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
  return ok(res, { deleted: true });
});

export default router;
