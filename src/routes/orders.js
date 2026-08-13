import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber, genNo, money } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

const ORDER_FLOW = [
  'PLACED',
  'PAYMENT_RECEIVED',
  'CONFIRMED',
  'PROCESSING',
  'READY_FOR_DELIVERY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

router.get('/', authRequired, async (req, res) => {
  try {
    const { page, limit, skip } = paginate(req.query);
    const { search, status, paymentStatus } = req.query;
    const where = {};
    if (status) where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (search) {
      where.OR = [
        { orderNo: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: {
          customer: true,
          assignedStaff: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { orderDate: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        assignedStaff: { select: { id: true, name: true, email: true } },
        items: { include: { product: true, productSerial: true } },
        payments: { orderBy: { paidAt: 'desc' } },
        delivery: { include: { assignedTo: { select: { id: true, name: true } } } },
        statusLogs: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) return fail(res, 404, 'Order not found');
    return ok(res, decimalToNumber({ ...order, timeline: ORDER_FLOW }));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    const { customerId, items, paymentMethod, shippingAddress, shippingCity, shippingState, shippingPincode, deliveryCharge = 0, discount = 0, notes } = req.body;
    if (!customerId || !items?.length) return fail(res, 400, 'customer and items required');

    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const map = Object.fromEntries(products.map((p) => [p.id, p]));

    let subtotal = 0;
    const lineItems = items.map((i) => {
      const p = map[i.productId];
      if (!p) throw new Error(`Product ${i.productId} not found`);
      const qty = i.quantity || 1;
      if (p.stock < qty) throw new Error(`Insufficient stock for ${p.name}`);
      const unitPrice = money(i.unitPrice ?? p.price);
      const total = unitPrice * qty;
      subtotal += total;
      return { productId: p.id, quantity: qty, unitPrice, total, productSerialId: i.productSerialId || null };
    });

    const totalAmount = subtotal + money(deliveryCharge) - money(discount);

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNo: genNo('ORD'),
          customerId,
          paymentMethod,
          shippingAddress,
          shippingCity,
          shippingState,
          shippingPincode,
          subtotal,
          deliveryCharge,
          discount,
          totalAmount,
          notes,
          status: 'PLACED',
          paymentStatus: 'PENDING',
          items: { create: lineItems },
          statusLogs: { create: { status: 'PLACED', note: 'Order placed', userId: req.user.id } },
        },
        include: { customer: true, items: { include: { product: true } } },
      });

      for (const item of lineItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { decrement: item.quantity },
            status: undefined,
          },
        });
        const updated = await tx.product.findUnique({ where: { id: item.productId } });
        if (updated.stock <= 0) {
          await tx.product.update({ where: { id: item.productId }, data: { status: 'OUT_OF_STOCK', stock: 0 } });
        }
        if (item.productSerialId) {
          await tx.productSerial.update({ where: { id: item.productSerialId }, data: { status: 'SOLD' } });
        }
      }
      return created;
    });

    return ok(res, decimalToNumber(order));
  } catch (e) {
    return fail(res, 400, e.message);
  }
});

router.patch('/:id/status', authRequired, async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!ORDER_FLOW.includes(status) && status !== 'CANCELLED') return fail(res, 400, 'Invalid status');

    const order = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: req.params.id },
        data: {
          status,
          ...(status === 'PAYMENT_RECEIVED' ? { paymentStatus: 'PAID' } : {}),
          statusLogs: { create: { status, note: note || `Status → ${status}`, userId: req.user.id } },
        },
        include: {
          customer: true,
          items: { include: { product: true } },
          statusLogs: { orderBy: { createdAt: 'asc' } },
          delivery: true,
        },
      });

      if (status === 'READY_FOR_DELIVERY' || status === 'OUT_FOR_DELIVERY') {
        await tx.delivery.upsert({
          where: { orderId: updated.id },
          update: { status: status === 'OUT_FOR_DELIVERY' ? 'IN_TRANSIT' : 'PENDING' },
          create: { orderId: updated.id, status: 'PENDING' },
        });
      }
      if (status === 'DELIVERED') {
        await tx.delivery.upsert({
          where: { orderId: updated.id },
          update: { status: 'DELIVERED', deliveredAt: new Date() },
          create: { orderId: updated.id, status: 'DELIVERED', deliveredAt: new Date() },
        });
        for (const item of updated.items) {
          const end = new Date();
          end.setMonth(end.getMonth() + (item.product.warrantyMonths || 6));
          await tx.warranty.create({
            data: {
              warrantyNo: genNo('WRN'),
              orderId: updated.id,
              productId: item.productId,
              customerName: updated.customer.name,
              serialNo: item.productSerial?.serial,
              endDate: end,
              status: 'ACTIVE',
            },
          });
        }
      }
      if (status === 'CANCELLED') {
        for (const item of updated.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity }, status: 'PUBLISHED' },
          });
        }
      }
      return updated;
    });

    return ok(res, decimalToNumber(order));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.patch('/:id/assign-staff', authRequired, async (req, res) => {
  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: { assignedStaffId: req.body.staffId },
    include: { assignedStaff: { select: { id: true, name: true } } },
  });
  return ok(res, decimalToNumber(order));
});

router.patch('/:id/assign-delivery', authRequired, async (req, res) => {
  const { courierName, trackingNo, assignedToId, estimatedDate } = req.body;
  const delivery = await prisma.delivery.upsert({
    where: { orderId: req.params.id },
    update: { courierName, trackingNo, assignedToId, estimatedDate, status: 'ASSIGNED' },
    create: {
      orderId: req.params.id,
      courierName,
      trackingNo,
      assignedToId,
      estimatedDate,
      status: 'ASSIGNED',
    },
    include: { assignedTo: { select: { id: true, name: true } } },
  });
  await prisma.order.update({
    where: { id: req.params.id },
    data: {
      status: 'READY_FOR_DELIVERY',
      statusLogs: { create: { status: 'READY_FOR_DELIVERY', note: 'Delivery assigned', userId: req.user.id } },
    },
  });
  return ok(res, delivery);
});

export default router;
