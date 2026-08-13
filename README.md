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

## Vercel deploy

Set these Environment Variables in the Vercel project:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Supabase URL with `?sslmode=require` (see `.env.example`) |
| `JWT_SECRET` | a long random secret |
| `CLIENT_URL` | `https://refurbicon-bhilwara.vercel.app` |

Root/entry for Vercel is configured via `vercel.json` → `api/index.js`.

After env vars are set, redeploy. Check `https://refurbicon-backend.vercel.app/api/health`.

