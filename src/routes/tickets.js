import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber, genNo } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

function isStaffOnly(user) {
  const role = user?.role?.name;
  const perms = user?.role?.permissions || [];
  return role === 'Staff' || (!perms.includes('*') && role !== 'Admin' && role !== 'Manager');
}

const includeDetail = {
  customer: { select: { id: true, name: true, phone: true, email: true } },
  order: { select: { id: true, orderNo: true } },
  createdBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  comments: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  },
};

router.get('/', authRequired, async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.priority) where.priority = req.query.priority;
  if (req.query.category) where.category = req.query.category;
  if (req.query.assignedToId) where.assignedToId = req.query.assignedToId;
  if (req.query.mine === '1' || isStaffOnly(req.user)) {
    where.OR = [{ assignedToId: req.user.id }, { createdById: req.user.id }];
  }
  if (req.query.search) {
    const search = {
      OR: [
        { ticketNo: { contains: req.query.search, mode: 'insensitive' } },
        { subject: { contains: req.query.search, mode: 'insensitive' } },
        { customer: { name: { contains: req.query.search, mode: 'insensitive' } } },
      ],
    };
    where.AND = [...(where.AND || []), search];
  }

  const [total, items] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { comments: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);
  return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) });
});

router.get('/:id', authRequired, async (req, res) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    include: includeDetail,
  });
  if (!ticket) return fail(res, 404, 'Ticket not found');
  if (isStaffOnly(req.user) && ticket.assignedToId !== req.user.id && ticket.createdById !== req.user.id) {
    return fail(res, 403, 'Not allowed to view this ticket');
  }
  return ok(res, decimalToNumber(ticket));
});

router.post('/', authRequired, async (req, res) => {
  try {
    const {
      subject,
      description,
      category = 'GENERAL',
      priority = 'MEDIUM',
      customerId,
      orderId,
      assignedToId,
      status = 'OPEN',
    } = req.body;
    if (!subject?.trim()) return fail(res, 400, 'Subject required');

    const ticket = await prisma.ticket.create({
      data: {
        ticketNo: genNo('TKT'),
        subject: subject.trim(),
        description,
        category,
        priority,
        status,
        customerId: customerId || null,
        orderId: orderId || null,
        assignedToId: assignedToId || (isStaffOnly(req.user) ? req.user.id : null),
        createdById: req.user.id,
      },
      include: includeDetail,
    });
    return ok(res, decimalToNumber(ticket));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    const existing = await prisma.ticket.findUnique({ where: { id: req.params.id } });
    if (!existing) return fail(res, 404, 'Ticket not found');
    if (isStaffOnly(req.user) && existing.assignedToId !== req.user.id && existing.createdById !== req.user.id) {
      return fail(res, 403, 'Not allowed');
    }

    const data = {};
    for (const key of ['subject', 'description', 'category', 'priority', 'status', 'customerId', 'orderId', 'assignedToId']) {
      if (req.body[key] !== undefined) data[key] = req.body[key] || null;
    }
    if (['RESOLVED', 'CLOSED'].includes(data.status) && !existing.resolvedAt) {
      data.resolvedAt = new Date();
    }
    if (data.status && !['RESOLVED', 'CLOSED'].includes(data.status)) {
      data.resolvedAt = null;
    }

    const ticket = await prisma.ticket.update({
      where: { id: req.params.id },
      data,
      include: includeDetail,
    });
    return ok(res, decimalToNumber(ticket));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.post('/:id/comments', authRequired, async (req, res) => {
  try {
    const existing = await prisma.ticket.findUnique({ where: { id: req.params.id } });
    if (!existing) return fail(res, 404, 'Ticket not found');
    if (isStaffOnly(req.user) && existing.assignedToId !== req.user.id && existing.createdById !== req.user.id) {
      return fail(res, 403, 'Not allowed');
    }
    if (!req.body.body?.trim()) return fail(res, 400, 'Comment required');

    await prisma.ticketComment.create({
      data: {
        ticketId: req.params.id,
        userId: req.user.id,
        body: req.body.body.trim(),
      },
    });

    if (existing.status === 'OPEN') {
      await prisma.ticket.update({ where: { id: req.params.id }, data: { status: 'IN_PROGRESS' } });
    }

    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id }, include: includeDetail });
    return ok(res, decimalToNumber(ticket));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    if (isStaffOnly(req.user)) return fail(res, 403, 'Staff cannot delete tickets');
    await prisma.ticketComment.deleteMany({ where: { ticketId: req.params.id } });
    await prisma.ticket.delete({ where: { id: req.params.id } });
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

export default router;
