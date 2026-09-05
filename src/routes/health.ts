import { Router } from 'express';
import { checkPostgres } from '../db';
import { asyncHandler } from '../middleware';

export const healthRouter = Router();

async function redisStatus(): Promise<'ok' | 'disabled' | 'error'> {
  const url = process.env.REDIS_URL;
  // Redis is optional; BullMQ/features degrade gracefully without it.
  if (!url) return 'disabled';
  try {
    // Lazy import to avoid hard dependency at boot
    const { default: IORedis } = await import('ioredis');
    const r = new IORedis(url, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 1 });
    await r.ping();
    await r.quit().catch(() => {});
    return 'ok';
  } catch {
    return 'error';
  }
}

healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const postgres = await checkPostgres();
    const redis = await redisStatus();
    const degraded = postgres !== 'ok';
    res.status(degraded ? 503 : 200).json({
      status: degraded ? 'degraded' : 'ok',
      checks: { api: 'ok', postgres, redis },
      timestamp: new Date().toISOString(),
    });
  })
);

healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const postgres = await checkPostgres();
    if (postgres !== 'ok') {
      return res.status(503).json({ status: 'not ready' });
    }
    res.json({ status: 'ready' });
  })
);
