import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

export const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

export async function checkPostgres(): Promise<'ok' | 'error'> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch (e) {
    logger.warn('postgres check failed', { error: (e as Error).message });
    return 'error';
  }
}
