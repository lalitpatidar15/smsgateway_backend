import { prisma } from './db';
import { config } from './config';
import { logger } from './logger';
import { retryDueWebhookDeliveries } from './webhooks';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

export async function runMaintenance() {
  try {
    const now = new Date();
    // 1. Expire stale claims -> back to QUEUED so another gateway can pick up
    const expired = await prisma.smsJob.updateMany({
      where: { status: 'CLAIMED', claimExpiresAt: { lt: now } },
      data: { status: 'QUEUED', gatewayDeviceId: null, claimedAt: null, claimExpiresAt: null },
    });
    if (expired.count > 0) logger.info('expired claims released', { count: expired.count });

    // 1b. Failover: release claims held by disabled/blocked gateways -> QUEUED
    const heldByBadGateway = await prisma.smsJob.findMany({
      where: { status: 'CLAIMED', gatewayDeviceId: { not: null } },
      include: { gateway: true },
    });
    for (const j of heldByBadGateway) {
      const bad = (j as any).gateway?.status;
      if (bad === 'DISABLED' || bad === 'BLOCKED') {
        await prisma.smsJob.update({
          where: { id: j.id },
          data: { status: 'QUEUED', gatewayDeviceId: null, claimedAt: null, claimExpiresAt: null },
        });
      }
    }
    if (heldByBadGateway.length > 0) logger.info('claims released from bad gateways', { count: heldByBadGateway.length });

    // 2. Promote due SCHEDULED -> QUEUED
    const due = await prisma.smsJob.updateMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
      data: { status: 'QUEUED' },
    });
    if (due.count > 0) logger.info('scheduled promoted', { count: due.count });

    // 3. Retry due webhooks
    await retryDueWebhookDeliveries().catch(() => {});
  } catch (e) {
    logger.warn('maintenance failed', { error: (e as Error).message });
  }
}

const SMS_QUEUE = 'sms-gateway-maintenance';
const WEBHOOK_RETRY_QUEUE = 'sms-gateway-webhook-retries';

let smsWorker: Worker | null = null;
let webhookWorker: Worker | null = null;

function redisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (url) return new IORedis(url);
  return new IORedis({ host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379) });
}

async function canUseRedis(): Promise<boolean> {
  try {
    const c = redisConnection();
    const ok = await c.ping();
    if (ok) return true;
    await c.quit().catch(() => {});
    return false;
  } catch {
    return false;
  }
}

async function startBullMq(): Promise<void> {
  const connection = redisConnection();

  if (!smsWorker) {
    smsWorker = new Worker(SMS_QUEUE, async () => {
      await runMaintenance();
    }, { connection, name: 'sms-maintenance-worker' });
  }
  if (!webhookWorker) {
    webhookWorker = new Worker(WEBHOOK_RETRY_QUEUE, async () => {
      await retryDueWebhookDeliveries().catch(() => {});
    }, { connection, name: 'webhook-retry-worker' });
  }

  const smsQueue = new Queue(SMS_QUEUE, { connection });
  await smsQueue.add('maintenance', {}, { repeat: { every: 30000 } }).catch(() => {});
  const webhookQueue = new Queue(WEBHOOK_RETRY_QUEUE, { connection });
  await webhookQueue.add('retry-webhooks', {}, { repeat: { every: 30000 } }).catch(() => {});
}

export async function startScheduler() {
  const useBullMq = await canUseRedis();
  if (useBullMq) {
    await startBullMq();
    return;
  }
  // Fallback: in-memory interval when Redis is unavailable
  const t = setInterval(() => {
    runMaintenance().catch(() => {});
  }, 30000);
  (t as any).unref?.();
  runMaintenance().catch(() => {});
}

export async function stopScheduler(): Promise<void> {
  const closeWorker = async (w: Worker | null) => {
    if (!w) return;
    try {
      await w.close();
    } catch {
      // ignore
    }
  };
  await closeWorker(smsWorker);
  await closeWorker(webhookWorker);
  smsWorker = null;
  webhookWorker = null;
}
