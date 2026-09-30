import { PrismaClient } from '@prisma/client';

const globalDb = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalDb.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
});

if (process.env.NODE_ENV !== 'production') globalDb.prisma = prisma;
