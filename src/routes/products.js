import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber, genNo } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req.query);
    const { search, status, categoryId, brandId } = req.query;
    const where = {};
    if (status) where.status = status;
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: { brand: true, category: true, _count: { select: { serialNumbers: true } } },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.get('/meta/options', authRequired, async (_req, res) => {
  const [brands, categories] = await Promise.all([
    prisma.brand.findMany({ orderBy: { name: 'asc' } }),
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
  ]);
  return ok(res, { brands, categories });
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        brand: true,
        category: true,
        serialNumbers: { orderBy: { createdAt: 'desc' } },
        history: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!product) return fail(res, 404, 'Product not found');
    return ok(res, decimalToNumber(product));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    const data = req.body;
    if (!data.name || !data.sku || data.price == null) return fail(res, 400, 'name, sku, price required');

    let brandId = data.brandId;
    let categoryId = data.categoryId;
    if (data.brandName && !brandId) {
      const brand = await prisma.brand.upsert({
        where: { name: data.brandName },
        update: {},
        create: { name: data.brandName },
      });
      brandId = brand.id;
    }
    if (data.categoryName && !categoryId) {
      const cat = await prisma.category.upsert({
        where: { name: data.categoryName },
        update: {},
        create: { name: data.categoryName },
      });
      categoryId = cat.id;
    }

    const product = await prisma.product.create({
      data: {
        name: data.name,
        sku: data.sku,
        description: data.description,
        price: data.price,
        costPrice: data.costPrice,
        stock: data.stock || 0,
        lowStockAt: data.lowStockAt ?? 5,
        condition: data.condition || 'Refurbished Grade A',
        warrantyMonths: data.warrantyMonths ?? 6,
        status: data.status || 'PUBLISHED',
        specifications: data.specifications || {},
        qcDetails: data.qcDetails || {},
        images: data.images || [],
        brandId,
        categoryId,
        history: {
          create: { action: 'CREATED', note: 'Product created', userId: req.user.id },
        },
      },
      include: { brand: true, category: true },
    });
    return ok(res, decimalToNumber(product));
  } catch (e) {
    if (e.code === 'P2002') return fail(res, 400, 'SKU already exists');
    return fail(res, 500, e.message);
  }
});

router.put('/:id', authRequired, async (req, res) => {
  try {
    const data = req.body;
    let brandId = data.brandId;
    let categoryId = data.categoryId;
    if (data.brandName && !brandId) {
      const brand = await prisma.brand.upsert({
        where: { name: data.brandName },
        update: {},
        create: { name: data.brandName },
      });
      brandId = brand.id;
    }
    if (data.categoryName && !categoryId) {
      const cat = await prisma.category.upsert({
        where: { name: data.categoryName },
        update: {},
        create: { name: data.categoryName },
      });
      categoryId = cat.id;
    }

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        sku: data.sku,
        description: data.description,
        price: data.price,
        costPrice: data.costPrice,
        stock: data.stock,
        lowStockAt: data.lowStockAt,
        condition: data.condition,
        warrantyMonths: data.warrantyMonths,
        status: data.status,
        specifications: data.specifications,
        qcDetails: data.qcDetails,
        images: data.images,
        brandId,
        categoryId,
        history: {
          create: { action: 'UPDATED', note: data.note || 'Product updated', userId: req.user.id },
        },
      },
      include: { brand: true, category: true },
    });
    return ok(res, decimalToNumber(product));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.post('/:id/serials', authRequired, async (req, res) => {
  try {
    const serials = Array.isArray(req.body.serials) ? req.body.serials : [req.body.serial];
    const created = await prisma.$transaction(
      serials.filter(Boolean).map((serial) =>
        prisma.productSerial.create({
          data: { serial, productId: req.params.id, status: 'IN_STOCK' },
        })
      )
    );
    await prisma.product.update({
      where: { id: req.params.id },
      data: {
        stock: { increment: created.length },
        history: { create: { action: 'SERIALS_ADDED', note: `Added ${created.length} serials`, userId: req.user.id } },
      },
    });
    return ok(res, created);
  } catch (e) {
    if (e.code === 'P2002') return fail(res, 400, 'Serial already exists');
    return fail(res, 500, e.message);
  }
});

router.post('/brands', authRequired, async (req, res) => {
  const brand = await prisma.brand.create({ data: { name: req.body.name } });
  return ok(res, brand);
});

router.put('/brands/:id', authRequired, async (req, res) => {
  try {
    const brand = await prisma.brand.update({ where: { id: req.params.id }, data: { name: req.body.name } });
    return ok(res, brand);
  } catch (e) {
    if (e.code === 'P2002') return fail(res, 400, 'Brand already exists');
    return fail(res, 500, e.message);
  }
});

router.delete('/brands/:id', authRequired, async (req, res) => {
  try {
    await prisma.brand.delete({ where: { id: req.params.id } });
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, 400, 'Cannot delete brand in use');
  }
});

router.post('/categories', authRequired, async (req, res) => {
  const category = await prisma.category.create({ data: { name: req.body.name } });
  return ok(res, category);
});

router.put('/categories/:id', authRequired, async (req, res) => {
  try {
    const category = await prisma.category.update({ where: { id: req.params.id }, data: { name: req.body.name } });
    return ok(res, category);
  } catch (e) {
    if (e.code === 'P2002') return fail(res, 400, 'Category already exists');
    return fail(res, 500, e.message);
  }
});

router.delete('/categories/:id', authRequired, async (req, res) => {
  try {
    await prisma.category.delete({ where: { id: req.params.id } });
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, 400, 'Cannot delete category in use');
  }
});

export default router;
