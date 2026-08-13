import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import productRoutes from './routes/products.js';
import customerRoutes from './routes/customers.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payments.js';
import deliveryRoutes from './routes/deliveries.js';
import warrantyRoutes from './routes/warranties.js';
import purchaseRoutes from './routes/purchases.js';
import inventoryRoutes from './routes/inventory.js';
import employeeRoutes from './routes/employees.js';
import attendanceRoutes from './routes/attendance.js';
import leaveRoutes from './routes/leaves.js';
import payrollRoutes from './routes/payroll.js';
import performanceRoutes from './routes/performance.js';
import reportRoutes from './routes/reports.js';
import userRoutes from './routes/users.js';
import roleRoutes from './routes/roles.js';
import settingRoutes from './routes/settings.js';
import salesRoutes from './routes/sales.js';
import storeRoutes from './routes/store.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadDir));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'REFURBICON API' }));

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/warranties', warrantyRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/store', storeRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Server error' });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`REFURBICON API running on http://localhost:${port}`));
