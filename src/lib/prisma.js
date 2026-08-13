import { PrismaClient } from '@prisma/client';

/**
 * Serverless-safe Prisma singleton (same idea as pg Pool reuse in /backend).
 * Reuses the client across warm Vercel invocations.
 */
const globalForPrisma = globalThis;

function createPrisma() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
}

const prisma = globalForPrisma.__refurbiconPrisma ?? createPrisma();

if (!globalForPrisma.__refurbiconPrisma) {
  globalForPrisma.__refurbiconPrisma = prisma;
}

export default prisma;
