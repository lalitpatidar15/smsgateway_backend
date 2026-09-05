import { prisma } from './db';
import { config } from './config';
import { logger } from './logger';
import { randomSecret } from './utils';

export async function createEndpoint(url: string, events: string[], gatewayDeviceId?: string | null) {
  return prisma.webhookEndpoint.create({
    data: {
      url,
      secret: randomSecret(24),
      events: events && events.length > 0 ? events : ['sms.sent', 'sms.delivered', 'sms.failed'],
      gatewayDeviceId: gatewayDeviceId ?? null,
      isActive: true,
    },
  });
}

function delayForAttempt(attempt: number): number {
  const arr = config.webhookRetryDelaysMs;
  if (attempt <= 0) return 0;
  return arr[Math.min(attempt - 1, arr.length - 1)] ?? 60000;
}

export function fireWebhook(event: string, smsJob: any) {
  // fire-and-forget; errors handled internally
  dispatchWebhook(event, smsJob).catch((e) => logger.warn('webhook dispatch failed', { event, error: (e as Error).message }));
}

async function dispatchWebhook(event: string, smsJob: any) {
  const endpoints = await prisma.webhookEndpoint.findMany({ where: { isActive: true } });
  const targets = endpoints.filter((ep) => {
    if (ep.gatewayDeviceId && smsJob?.gatewayDeviceId && ep.gatewayDeviceId !== smsJob.gatewayDeviceId) return false;
    if (ep.events && ep.events.length > 0 && !ep.events.includes(event) && !ep.events.includes('*')) return false;
    return true;
  });
  for (const ep of targets) {
    const payload = { event, job: smsJob, timestamp: new Date().toISOString() };
    const delivery = await prisma.webhookDelivery.create({
      data: {
        webhookEndpointId: ep.id,
        smsJobId: smsJob?.id ?? null,
        event,
        payload: payload as any,
        status: 'PENDING',
        attemptCount: 0,
        maxAttempts: config.webhookMaxAttempts,
      },
    });
    attemptDelivery(delivery.id).catch(() => {});
  }
}

export async function attemptDelivery(deliveryId: string) {
  const d = await prisma.webhookDelivery.findUnique({
    include: { endpoint: true },
    where: { id: deliveryId },
  });
  if (!d || d.status === 'SUCCESS') return;
  if (d.attemptCount >= d.maxAttempts) {
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'FAILED' } });
    return;
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(d.endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event': d.event,
        'X-Webhook-Secret': d.endpoint.secret,
      },
      body: JSON.stringify(d.payload),
      signal: controller.signal as any,
    });
    const text = await res.text().catch(() => '');
    if (res.ok) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { status: 'SUCCESS', statusCode: res.status, response: text.slice(0, 2000), attemptCount: d.attemptCount + 1 },
      });
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (e: any) {
    const nextCount = d.attemptCount + 1;
    const failed = nextCount >= d.maxAttempts;
    await prisma.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status: failed ? 'FAILED' : 'PENDING',
        statusCode: null,
        response: String(e?.message ?? e).slice(0, 2000),
        attemptCount: nextCount,
        nextRetryAt: failed ? null : new Date(Date.now() + delayForAttempt(nextCount)),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

export async function retryDueWebhookDeliveries() {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'PENDING', nextRetryAt: { lte: new Date() } },
    take: 50,
  });
  for (const d of due) {
    await attemptDelivery(d.id).catch(() => {});
  }
}
