import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import { ok, fail, decimalToNumber } from '../lib/helpers.js';
import { authRequired, signToken } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return fail(res, 400, 'Email and password required');

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { role: true, employee: true },
    });
    if (!user || !user.isActive) return fail(res, 401, 'Invalid credentials');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return fail(res, 401, 'Invalid credentials');

    const token = signToken(user);
    const { passwordHash, ...safe } = user;
    return ok(res, { token, user: decimalToNumber(safe) });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.get('/me', authRequired, async (req, res) => {
  const { passwordHash, ...safe } = req.user;
  return ok(res, decimalToNumber(safe));
});

router.post('/change-password', authRequired, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return fail(res, 400, 'Both passwords required');
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return fail(res, 400, 'Current password is incorrect');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    return ok(res, { message: 'Password updated' });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
