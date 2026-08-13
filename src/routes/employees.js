import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import { ok, fail, paginate, decimalToNumber, genNo } from '../lib/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.departmentId) where.departmentId = req.query.departmentId;
  if (req.query.search) {
    where.OR = [
      { firstName: { contains: req.query.search, mode: 'insensitive' } },
      { lastName: { contains: req.query.search, mode: 'insensitive' } },
      { employeeNo: { contains: req.query.search, mode: 'insensitive' } },
      { email: { contains: req.query.search, mode: 'insensitive' } },
    ];
  }
  const [total, items] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      include: { department: true, user: { select: { id: true, email: true, isActive: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);
  return ok(res, decimalToNumber(items), { page, limit, total, pages: Math.ceil(total / limit) });
});

router.get('/departments', authRequired, async (_req, res) => {
  const departments = await prisma.department.findMany({
    include: { _count: { select: { employees: true } } },
    orderBy: { name: 'asc' },
  });
  return ok(res, departments);
});

router.post('/departments', authRequired, async (req, res) => {
  const dept = await prisma.department.create({ data: { name: req.body.name } });
  return ok(res, dept);
});

router.get('/:id', authRequired, async (req, res) => {
  const employee = await prisma.employee.findUnique({
    where: { id: req.params.id },
    include: {
      department: true,
      user: { select: { id: true, email: true, role: true } },
      performances: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });
  if (!employee) return fail(res, 404, 'Employee not found');
  return ok(res, decimalToNumber(employee));
});

router.post('/', authRequired, async (req, res) => {
  try {
    const data = req.body;
    let userId = data.userId;
    if (data.createLogin && data.email) {
      const staffRole = await prisma.role.findFirst({ where: { name: 'Staff' } });
      const passwordHash = await bcrypt.hash(data.password || 'staff123', 10);
      const user = await prisma.user.create({
        data: {
          email: data.email.toLowerCase(),
          passwordHash,
          name: `${data.firstName} ${data.lastName}`,
          phone: data.phone,
          roleId: staffRole.id,
        },
      });
      userId = user.id;
    }

    const employee = await prisma.employee.create({
      data: {
        employeeNo: data.employeeNo || genNo('EMP'),
        userId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        photoUrl: data.photoUrl,
        departmentId: data.departmentId,
        designation: data.designation,
        joinDate: data.joinDate ? new Date(data.joinDate) : new Date(),
        status: data.status || 'ACTIVE',
        basicSalary: data.basicSalary || 0,
        hra: data.hra || 0,
        conveyance: data.conveyance || 0,
        otherAllow: data.otherAllow || 0,
        shiftStart: data.shiftStart || '09:00',
        shiftEnd: data.shiftEnd || '18:00',
      },
      include: { department: true },
    });
    return ok(res, decimalToNumber(employee));
  } catch (e) {
    if (e.code === 'P2002') return fail(res, 400, 'Email or employee number already exists');
    return fail(res, 500, e.message);
  }
});

router.put('/:id', authRequired, async (req, res) => {
  try {
    const allowed = [
      'firstName', 'lastName', 'email', 'phone', 'photoUrl', 'departmentId', 'designation',
      'joinDate', 'status', 'basicSalary', 'hra', 'conveyance', 'otherAllow', 'shiftStart', 'shiftEnd',
    ];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    if (data.joinDate) data.joinDate = new Date(data.joinDate);
    if (data.departmentId === '') data.departmentId = null;

    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data,
      include: { department: true },
    });
    return ok(res, decimalToNumber(employee));
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  await prisma.employee.update({ where: { id: req.params.id }, data: { status: 'INACTIVE' } });
  return ok(res, { deleted: true });
});

export default router;
