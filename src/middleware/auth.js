import jwt from 'jsonwebtoken';
import { fail } from '../lib/helpers.js';
import prisma from '../lib/prisma.js';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role?.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

export async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return fail(res, 401, 'Authentication required');

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      include: { role: true, employee: true },
    });
    if (!user || !user.isActive) return fail(res, 401, 'Invalid or inactive user');

    req.user = user;
    next();
  } catch {
    return fail(res, 401, 'Invalid or expired token');
  }
}

export function requirePermission(...perms) {
  return (req, res, next) => {
    const permissions = req.user?.role?.permissions || [];
    const roleName = req.user?.role?.name;
    if (roleName === 'Admin' || permissions.includes('*')) return next();
    const ok = perms.some((p) => permissions.includes(p));
    if (!ok) return fail(res, 403, 'Insufficient permissions');
    next();
  };
}
