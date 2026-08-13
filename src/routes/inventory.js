import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber, money } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req.query);
    const filter = req.query.filter; // all | low | out
    const search = req.query.search;
    const where = {};
    if (filter === 'out') where.stock = 0;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filter === 'low') {
      // stock > 0 AND stock <= lowStockAt handled via raw or post-filter
    }

    let items;
    let total;
    if (filter === 'low') {
      const all = await prisma.$queryRaw`
        SELECT p.id FROM "Product" p WHERE p.stock > 0 AND p.stock <= p."lowStockAt"
      `;
      let ids = all.map((r) => r.id);
      if (search) {
        const matched = await prisma.product.findMany({
          where: {
            id: { in: ids },
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
        ids = matched.map((m) => m.id);
      }
      total = ids.length;
      items = await prisma.product.findMany({
        where: { id: { in: ids.slice(skip, skip + limit) } },
        include: { brand: true, category: true },
        orderBy: { stock: 'asc' },
      });
    } else {
      [total, items] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where,
          include: { brand: true, category: true },
          orderBy: { stock: 'asc' },
          skip,
          take: limit,
        }),
      ]);
    }

    const stockValue = items.reduce((s, p) => s + p.stock * money(p.costPrice || p.price), 0);
    return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit), stockValue });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.post('/adjust', authRequired, async (req, res) => {
  try {
    const { productId, quantity, note, type } = req.body; // type: IN | OUT | SET
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return fail(res, 404, 'Product not found');

    let stock = product.stock;
    if (type === 'IN') stock += quantity;
    else if (type === 'OUT') stock = Math.max(0, stock - quantity);
    else if (type === 'SET') stock = quantity;
    else return fail(res, 400, 'Invalid type');

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        stock,
        status: stock === 0 ? 'OUT_OF_STOCK' : product.status === 'OUT_OF_STOCK' ? 'PUBLISHED' : product.status,
        history: {
          create: {
            action: 'STOCK_ADJUST',
            note: note || `${type} ${quantity}`,
            userId: req.user.id,
          },
        },
      },
      include: { brand: true, category: true },
    });
    return ok(res, decimalToNumber(updated));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
