import { prisma } from './db';
import { config } from './config';
import { logger } from './logger';
import { retryDueWebhookDeliveries } from './webhooks';

export async function runMaintenance() {
  try {
    const now = new Date();
    // 1. Expire stale claims -> back to QUEUED so another gateway can pick up
    const expired = await prisma.smsJob.updateMany({
      where: { status: 'CLAIMED', claimExpiresAt: { lt: now } },
      data: { status: 'QUEUED', gatewayDeviceId: null, claimedAt: null, claimExpiresAt: null },
    });
    if (expired.count > 0) logger.info('expired claims released', { count: expired.count });

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

export function startScheduler() {
  // Run every 30s
  setInterval(() => {
    runMaintenance().catch(() => {});
  }, 30000).unref?.();
  // initial run (async)
  runMaintenance().catch(() => {});
}
