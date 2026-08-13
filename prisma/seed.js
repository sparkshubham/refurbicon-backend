import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding REFURBICON database...');

  await prisma.orderStatusLog.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.warranty.deleteMany();
  await prisma.order.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.productHistory.deleteMany();
  await prisma.productSerial.deleteMany();
  await prisma.product.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.category.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.payroll.deleteMany();
  await prisma.performance.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.department.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.setting.deleteMany();

  const adminRole = await prisma.role.create({
    data: { name: 'Admin', description: 'Full system access', permissions: ['*'] },
  });
  const managerRole = await prisma.role.create({
    data: {
      name: 'Manager',
      description: 'Business + HR operations',
      permissions: ['products.*', 'orders.*', 'hr.*', 'reports.view'],
    },
  });
  const staffRole = await prisma.role.create({
    data: {
      name: 'Staff',
      description: 'Operational staff',
      permissions: ['orders.view', 'products.view', 'attendance.own'],
    },
  });

  const passwordHash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@refurbicon.com',
      passwordHash,
      name: 'System Admin',
      phone: '+91 90000 00001',
      roleId: adminRole.id,
    },
  });
  const managerHash = await bcrypt.hash('manager123', 10);
  const manager = await prisma.user.create({
    data: {
      email: 'manager@refurbicon.com',
      passwordHash: managerHash,
      name: 'Rahul Sharma',
      phone: '+91 90000 00002',
      roleId: managerRole.id,
    },
  });
  const staffHash = await bcrypt.hash('staff123', 10);
  const staffUser = await prisma.user.create({
    data: {
      email: 'staff@refurbicon.com',
      passwordHash: staffHash,
      name: 'Priya Patel',
      phone: '+91 90000 00003',
      roleId: staffRole.id,
    },
  });

  const depts = await Promise.all(
    ['Sales', 'Warehouse', 'QC', 'Delivery', 'HR', 'IT'].map((name) =>
      prisma.department.create({ data: { name } })
    )
  );

  const employees = await Promise.all([
    prisma.employee.create({
      data: {
        employeeNo: 'EMP-1001',
        userId: manager.id,
        firstName: 'Rahul',
        lastName: 'Sharma',
        email: 'manager@refurbicon.com',
        phone: '+91 90000 00002',
        departmentId: depts[0].id,
        designation: 'Sales Manager',
        basicSalary: 45000,
        hra: 12000,
        conveyance: 3000,
        otherAllow: 2000,
        status: 'ACTIVE',
      },
    }),
    prisma.employee.create({
      data: {
        employeeNo: 'EMP-1002',
        userId: staffUser.id,
        firstName: 'Priya',
        lastName: 'Patel',
        email: 'staff@refurbicon.com',
        phone: '+91 90000 00003',
        departmentId: depts[1].id,
        designation: 'Warehouse Executive',
        basicSalary: 28000,
        hra: 8000,
        conveyance: 2000,
        otherAllow: 1000,
        status: 'ACTIVE',
      },
    }),
    prisma.employee.create({
      data: {
        employeeNo: 'EMP-1003',
        firstName: 'Amit',
        lastName: 'Kumar',
        email: 'amit.kumar@refurbicon.com',
        phone: '+91 90000 00004',
        departmentId: depts[3].id,
        designation: 'Delivery Executive',
        basicSalary: 22000,
        hra: 6000,
        conveyance: 4000,
        status: 'ACTIVE',
      },
    }),
    prisma.employee.create({
      data: {
        employeeNo: 'EMP-1004',
        firstName: 'Sneha',
        lastName: 'Reddy',
        email: 'sneha.reddy@refurbicon.com',
        phone: '+91 90000 00005',
        departmentId: depts[2].id,
        designation: 'QC Specialist',
        basicSalary: 32000,
        hra: 9000,
        conveyance: 2000,
        status: 'ACTIVE',
      },
    }),
    prisma.employee.create({
      data: {
        employeeNo: 'EMP-1005',
        firstName: 'Vikram',
        lastName: 'Singh',
        email: 'vikram.singh@refurbicon.com',
        departmentId: depts[4].id,
        designation: 'HR Executive',
        basicSalary: 35000,
        hra: 10000,
        conveyance: 2500,
        status: 'ACTIVE',
      },
    }),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkIn = new Date(today);
  checkIn.setHours(9, 5, 0, 0);
  await prisma.attendance.createMany({
    data: [
      { employeeId: employees[0].id, date: today, checkIn, status: 'PRESENT', workingHours: 8.5, faceMatched: true },
      { employeeId: employees[1].id, date: today, checkIn: new Date(checkIn.getTime() + 40 * 60000), status: 'LATE', workingHours: 7.8, faceMatched: true },
      { employeeId: employees[2].id, date: today, checkIn, status: 'PRESENT', workingHours: 8.2 },
      { employeeId: employees[3].id, date: today, status: 'ON_LEAVE' },
      { employeeId: employees[4].id, date: today, checkIn, status: 'PRESENT', workingHours: 8.0 },
    ],
  });

  const brands = await Promise.all(
    ['Dell', 'HP', 'Lenovo', 'Apple', 'Samsung', 'Asus'].map((name) => prisma.brand.create({ data: { name } }))
  );
  const categories = await Promise.all(
    ['Laptop', 'Desktop', 'Monitor', 'Accessory', 'Mobile'].map((name) => prisma.category.create({ data: { name } }))
  );

  const products = await Promise.all([
    prisma.product.create({
      data: {
        name: 'Dell Latitude 5420',
        sku: 'DL-5420-I5',
        price: 32999,
        costPrice: 25000,
        stock: 24,
        condition: 'Refurbished Grade A',
        warrantyMonths: 6,
        status: 'PUBLISHED',
        brandId: brands[0].id,
        categoryId: categories[0].id,
        images: ['https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800'],
        specifications: {
          Processor: 'Intel Core i5-1135G7',
          RAM: '16GB DDR4',
          Storage: '512GB NVMe SSD',
          Display: '14" FHD IPS',
          OS: 'Windows 11 Pro',
          Graphics: 'Intel Iris Xe',
        },
        qcDetails: { batteryHealth: '92%', keyboard: 'Pass', display: 'Pass', ports: 'Pass', grade: 'A' },
        serialNumbers: {
          create: [
            { serial: 'DL5420-SN001', status: 'IN_STOCK' },
            { serial: 'DL5420-SN002', status: 'IN_STOCK' },
            { serial: 'DL5420-SN003', status: 'IN_STOCK' },
          ],
        },
        history: { create: { action: 'CREATED', note: 'Seed product', userId: admin.id } },
      },
    }),
    prisma.product.create({
      data: {
        name: 'HP EliteBook 840 G8',
        sku: 'HP-840G8-I7',
        price: 42999,
        costPrice: 34000,
        stock: 12,
        condition: 'Refurbished Grade A',
        brandId: brands[1].id,
        categoryId: categories[0].id,
        images: ['https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=800'],
        specifications: {
          Processor: 'Intel Core i7-1165G7',
          RAM: '16GB DDR4',
          Storage: '512GB SSD',
          Display: '14" FHD',
          OS: 'Windows 11 Pro',
        },
        qcDetails: { batteryHealth: '88%', grade: 'A' },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Lenovo ThinkPad T14',
        sku: 'LN-T14-R5',
        price: 38999,
        costPrice: 30000,
        stock: 3,
        lowStockAt: 5,
        condition: 'Refurbished Grade B',
        brandId: brands[2].id,
        categoryId: categories[0].id,
        images: ['https://images.unsplash.com/photo-1588872657578-7efd1f1555cd?w=800'],
        specifications: {
          Processor: 'AMD Ryzen 5 Pro',
          RAM: '16GB',
          Storage: '256GB SSD',
          Display: '14" FHD',
          OS: 'Windows 11 Pro',
        },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Dell UltraSharp U2720Q',
        sku: 'DL-U2720Q',
        price: 28999,
        costPrice: 22000,
        stock: 0,
        status: 'OUT_OF_STOCK',
        brandId: brands[0].id,
        categoryId: categories[2].id,
        images: ['https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=800'],
        specifications: { Size: '27"', Resolution: '4K UHD', Panel: 'IPS' },
      },
    }),
    prisma.product.create({
      data: {
        name: 'Apple MacBook Air M1',
        sku: 'AP-MBA-M1',
        price: 59999,
        costPrice: 48000,
        stock: 8,
        brandId: brands[3].id,
        categoryId: categories[0].id,
        warrantyMonths: 12,
        images: ['https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800'],
        specifications: {
          Processor: 'Apple M1',
          RAM: '8GB',
          Storage: '256GB SSD',
          Display: '13.3" Retina',
          OS: 'macOS Sequoia',
        },
      },
    }),
  ]);

  const customers = await Promise.all([
    prisma.customer.create({
      data: {
        name: 'Ananya Mehta',
        email: 'ananya@example.com',
        phone: '+91 98111 11111',
        address: '12 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
    }),
    prisma.customer.create({
      data: {
        name: 'TechNova Pvt Ltd',
        email: 'purchase@technova.com',
        phone: '+91 98222 22222',
        address: '45 Cyber Hub',
        city: 'Gurugram',
        state: 'Haryana',
        pincode: '122002',
      },
    }),
    prisma.customer.create({
      data: {
        name: 'Rohan Das',
        email: 'rohan.das@email.com',
        phone: '+91 98333 33333',
        address: '88 Park Street',
        city: 'Kolkata',
        state: 'West Bengal',
        pincode: '700016',
      },
    }),
  ]);

  const supplier = await prisma.supplier.create({
    data: {
      name: 'GreenTech Recyclers',
      email: 'supply@greentech.in',
      phone: '+91 98765 11111',
      address: 'Industrial Area, Pune',
    },
  });

  await prisma.purchase.create({
    data: {
      purchaseNo: 'PUR-2026-1001',
      supplierId: supplier.id,
      status: 'RECEIVED',
      totalAmount: 125000,
      items: {
        create: [
          { productId: products[0].id, quantity: 5, unitCost: 25000, total: 125000 },
        ],
      },
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNo: 'ORD-2026-5001',
      customerId: customers[0].id,
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      paymentMethod: 'UPI',
      shippingAddress: '12 MG Road',
      shippingCity: 'Bengaluru',
      shippingState: 'Karnataka',
      shippingPincode: '560001',
      subtotal: 32999,
      deliveryCharge: 199,
      discount: 500,
      totalAmount: 32698,
      assignedStaffId: manager.id,
      items: {
        create: [
          {
            productId: products[0].id,
            quantity: 1,
            unitPrice: 32999,
            total: 32999,
          },
        ],
      },
      statusLogs: {
        create: [
          { status: 'PLACED', note: 'Order placed', userId: admin.id, createdAt: new Date(Date.now() - 86400000 * 2) },
          { status: 'PAYMENT_RECEIVED', note: 'UPI payment received', userId: admin.id, createdAt: new Date(Date.now() - 86400000 * 2 + 3600000) },
          { status: 'CONFIRMED', note: 'Order confirmed', userId: manager.id, createdAt: new Date(Date.now() - 86400000) },
          { status: 'PROCESSING', note: 'QC packing started', userId: manager.id },
        ],
      },
      payments: {
        create: {
          paymentNo: 'PAY-2026-3001',
          customerId: customers[0].id,
          amount: 32698,
          method: 'UPI',
          status: 'PAID',
          reference: 'UPI-TXN-998877',
        },
      },
      delivery: {
        create: {
          status: 'PENDING',
          courierName: 'Refurbicon Express',
        },
      },
    },
  });

  await prisma.order.create({
    data: {
      orderNo: 'ORD-2026-5002',
      customerId: customers[1].id,
      status: 'PLACED',
      paymentStatus: 'PENDING',
      paymentMethod: 'Bank Transfer',
      shippingAddress: '45 Cyber Hub',
      shippingCity: 'Gurugram',
      shippingState: 'Haryana',
      shippingPincode: '122002',
      subtotal: 85998,
      deliveryCharge: 0,
      discount: 2000,
      totalAmount: 83998,
      items: {
        create: [
          { productId: products[1].id, quantity: 2, unitPrice: 42999, total: 85998 },
        ],
      },
      statusLogs: {
        create: { status: 'PLACED', note: 'Bulk order placed', userId: admin.id },
      },
    },
  });

  await prisma.warranty.create({
    data: {
      warrantyNo: 'WRN-2026-1001',
      orderId: order.id,
      productId: products[0].id,
      customerName: customers[0].name,
      serialNo: 'DL5420-SN000',
      endDate: new Date(Date.now() + 180 * 86400000),
      status: 'ACTIVE',
    },
  });

  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  for (const emp of employees) {
    const basic = Number(emp.basicSalary);
    const hra = Number(emp.hra);
    const conveyance = Number(emp.conveyance);
    const otherAllow = Number(emp.otherAllow);
    const gross = basic + hra + conveyance + otherAllow;
    const pf = Number(((basic * 12) / 100).toFixed(2));
    const professionalTax = 200;
    const esi = 0;
    const leaveDeduction = 0;
    const totalDeductions = pf + professionalTax + esi + leaveDeduction;
    await prisma.payroll.create({
      data: {
        employeeId: emp.id,
        month,
        year,
        basicSalary: basic,
        hra,
        conveyance,
        otherAllow,
        pf,
        professionalTax,
        esi,
        leaveDeduction,
        grossEarnings: gross,
        totalDeductions,
        netSalary: gross - totalDeductions,
        status: emp.employeeNo === 'EMP-1001' ? 'PAID' : 'PROCESSED',
        paidAt: emp.employeeNo === 'EMP-1001' ? new Date() : null,
      },
    });
  }

  await prisma.leaveRequest.create({
    data: {
      employeeId: employees[3].id,
      leaveType: 'Casual',
      startDate: today,
      endDate: today,
      reason: 'Personal work',
      status: 'APPROVED',
    },
  });

  await prisma.performance.create({
    data: {
      employeeId: employees[0].id,
      period: 'Q2 2026',
      rating: 4.5,
      goals: 'Increase sales conversion by 15%',
      feedback: 'Excellent leadership and consistent targets.',
      reviewedBy: 'System Admin',
    },
  });

  await prisma.setting.createMany({
    data: [
      { key: 'companyName', value: 'REFURBICON' },
      { key: 'companyEmail', value: 'support@refurbicon.com' },
      { key: 'companyPhone', value: '+91 98765 43210' },
      { key: 'companyAddress', value: 'Tech Park, Bengaluru, India' },
      { key: 'currency', value: 'INR' },
    ],
  });

  console.log('Seed complete.');
  console.log('Login: admin@refurbicon.com / admin123');
  console.log('Manager: manager@refurbicon.com / manager123');
  console.log('Staff: staff@refurbicon.com / staff123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
