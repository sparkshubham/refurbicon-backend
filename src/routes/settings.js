import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail } from '../lib/helpers.js';
import { authRequired, requirePermission } from '../middleware/auth.js';

const router = Router();

const DEFAULTS = {
  companyName: 'REFURBICON',
  companyEmail: 'support@refurbicon.com',
  companyPhone: '+91 98765 43210',
  companyAddress: 'Tech Park, Bengaluru, India',
  currency: 'INR',
  lowStockThreshold: 5,
  timezone: 'Asia/Kolkata',
};

router.get('/', authRequired, async (_req, res) => {
  const rows = await prisma.setting.findMany();
  const map = { ...DEFAULTS };
  for (const r of rows) map[r.key] = r.value;
  return ok(res, map);
});

router.put('/', authRequired, requirePermission('settings.manage', '*'), async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [key, value] of entries) {
      await prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }
    const rows = await prisma.setting.findMany();
    const map = { ...DEFAULTS };
    for (const r of rows) map[r.key] = r.value;
    return ok(res, map);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
