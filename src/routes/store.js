import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber, money, genNo } from '../lib/helpers.js';

const router = Router();

/** Public catalog — published / in-stock products only */
router.get('/products', async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req.query);
    const { search, categoryId, brandId, minPrice, maxPrice, sort } = req.query;

    const where = {
      status: { in: ['PUBLISHED', 'OUT_OF_STOCK'] },
    };
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = Number(minPrice);
      if (maxPrice) where.price.lte = Number(maxPrice);
    }

    let orderBy = { updatedAt: 'desc' };
    if (sort === 'price_asc') orderBy = { price: 'asc' };
    if (sort === 'price_desc') orderBy = { price: 'desc' };
    if (sort === 'name') orderBy = { name: 'asc' };

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: { brand: true, category: true },
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) || 1 });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.get('/products/:id', async (req, res) => {
  try {
    const product = await prisma.product.findFirst({
      where: {
        id: req.params.id,
        status: { in: ['PUBLISHED', 'OUT_OF_STOCK'] },
      },
      include: { brand: true, category: true },
    });
    if (!product) return fail(res, 404, 'Product not found');
    return ok(res, decimalToNumber(product));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.get('/meta', async (_req, res) => {
  try {
    const [brands, categories] = await Promise.all([
      prisma.brand.findMany({ orderBy: { name: 'asc' } }),
      prisma.category.findMany({ orderBy: { name: 'asc' } }),
    ]);
    return ok(res, { brands, categories });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.get('/featured', async (_req, res) => {
  try {
    const items = await prisma.product.findMany({
      where: { status: 'PUBLISHED', stock: { gt: 0 } },
      include: { brand: true, category: true },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    });
    return ok(res, decimalToNumber(items));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

/** Guest checkout from customer panel */
router.post('/checkout', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      address,
      city,
      state,
      pincode,
      paymentMethod = 'COD',
      items,
      notes,
    } = req.body;

    if (!name || !phone) return fail(res, 400, 'Name and phone are required');
    if (!items?.length) return fail(res, 400, 'Cart is empty');

    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, status: { in: ['PUBLISHED', 'OUT_OF_STOCK'] } },
    });
    const map = Object.fromEntries(products.map((p) => [p.id, p]));

    let subtotal = 0;
    const lineItems = items.map((i) => {
      const p = map[i.productId];
      if (!p) throw new Error(`Product not found`);
      const qty = Math.max(1, Number(i.quantity) || 1);
      if (p.stock < qty) throw new Error(`Insufficient stock for ${p.name}`);
      const unitPrice = money(p.price);
      const total = unitPrice * qty;
      subtotal += total;
      return { productId: p.id, quantity: qty, unitPrice, total };
    });

    const deliveryCharge = subtotal >= 25000 ? 0 : 199;
    const discount = 0;
    const totalAmount = subtotal + deliveryCharge - discount;

    const order = await prisma.$transaction(async (tx) => {
      let customer = null;
      if (email) {
        customer = await tx.customer.findFirst({ where: { email } });
      }
      if (!customer && phone) {
        customer = await tx.customer.findFirst({ where: { phone } });
      }
      if (customer) {
        customer = await tx.customer.update({
          where: { id: customer.id },
          data: {
            name,
            email: email || customer.email,
            phone,
            address: address || customer.address,
            city: city || customer.city,
            state: state || customer.state,
            pincode: pincode || customer.pincode,
          },
        });
      } else {
        customer = await tx.customer.create({
          data: { name, email: email || null, phone, address, city, state, pincode },
        });
      }

      const created = await tx.order.create({
        data: {
          orderNo: genNo('ORD'),
          customerId: customer.id,
          paymentMethod,
          shippingAddress: address,
          shippingCity: city,
          shippingState: state,
          shippingPincode: pincode,
          subtotal,
          deliveryCharge,
          discount,
          totalAmount,
          notes: notes || 'Customer panel order',
          status: 'PLACED',
          paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'PENDING',
          items: { create: lineItems },
          statusLogs: { create: { status: 'PLACED', note: 'Order placed via customer panel' } },
        },
        include: { customer: true, items: { include: { product: true } } },
      });

      for (const item of lineItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
        const updated = await tx.product.findUnique({ where: { id: item.productId } });
        if (updated.stock <= 0) {
          await tx.product.update({
            where: { id: item.productId },
            data: { status: 'OUT_OF_STOCK', stock: 0 },
          });
        }
      }

      return created;
    });

    return ok(res, decimalToNumber(order));
  } catch (e) {
    return fail(res, 400, e.message);
  }
});

export default router;
