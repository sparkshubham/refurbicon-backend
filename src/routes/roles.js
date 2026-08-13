import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail } from '../lib/helpers.js';
import { authRequired, requirePermission } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (_req, res) => {
  const roles = await prisma.role.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: { name: 'asc' },
  });
  return ok(res, roles);
});

router.post('/', authRequired, requirePermission('roles.manage', '*'), async (req, res) => {
  try {
    const role = await prisma.role.create({
      data: {
        name: req.body.name,
        description: req.body.description,
        permissions: req.body.permissions || [],
      },
    });
    return ok(res, role);
  } catch (e) {
    if (e.code === 'P2002') return fail(res, 400, 'Role already exists');
    return fail(res, 500, e.message);
  }
});

router.put('/:id', authRequired, requirePermission('roles.manage', '*'), async (req, res) => {
  const role = await prisma.role.update({
    where: { id: req.params.id },
    data: {
      name: req.body.name,
      description: req.body.description,
      permissions: req.body.permissions,
    },
  });
  return ok(res, role);
});

router.delete('/:id', authRequired, requirePermission('roles.manage', '*'), async (req, res) => {
  try {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) return fail(res, 404, 'Role not found');
    if (role._count.users > 0) return fail(res, 400, 'Role has assigned users');
    await prisma.role.delete({ where: { id: req.params.id } });
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
