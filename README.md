# REFURBICON Backend

Express + Prisma + PostgreSQL API for REFURBICON (admin ERP, customer shop, attendance).

## Setup

```bash
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

API runs at http://localhost:5000

## Env

Copy `.env.example` values into `.env`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/refurbicon"
JWT_SECRET="change-me"
PORT=5000
CLIENT_URL="http://localhost:5173"
```

## Health

`GET /api/health`
