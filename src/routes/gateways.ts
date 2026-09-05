import { Router } from 'express';
import { prisma } from '../db';
import { config } from '../config';
import { asyncHandler, httpError, requireAdmin, requireGateway, audit, AuthedRequest, rateLimit } from '../middleware';
import { hashToken, randomSecret, getClientIp } from '../utils';

export const gatewaysRouter = Router();

function publicGateway(g: any, sims?: any[]) {
  return {
    id: g.id,
    name: g.name,
    deviceId: g.deviceId,
    phoneNumber: g.phoneNumber ?? null,
    platform: g.platform,
    appVersion: g.appVersion ?? null,
    manufacturer: g.manufacturer ?? null,
    model: g.model ?? null,
    androidVersion: g.androidVersion ?? null,
    status: gatewayStatus(g),
    lastSeenAt: g.lastSeenAt ?? null,
    lastIp: g.lastIp ?? null,
    battery: g.battery ?? null,
    charging: g.charging ?? null,
    network: g.network ?? null,
    signalStrength: g.signalStrength ?? null,
    simCount: g.simCount ?? null,
    sims: sims ?? undefined,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

function gatewayStatus(g: any): string {
  if (g.status === 'DISABLED' || g.status === 'BLOCKED' || g.status === 'PENDING') return g.status;
  if (!g.lastSeenAt) return 'OFFLINE';
  const age = Date.now() - new Date(g.lastSeenAt).getTime();
  if (age <= config.heartbeatOnlineMs) return 'ACTIVE';
  if (age <= config.heartbeatDegradedMs) return 'DEGRADED';
  return 'OFFLINE';
}

// ---------- Device self-service (no auth for register, token auth after) ----------

gatewaysRouter.post(
  '/register',
  rateLimit(() => 'gw-register', 20, 60_000),
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const deviceId = String(b.deviceId ?? b.device_id ?? '').trim();
    const name = String(b.name ?? deviceId ?? '').trim();
    if (!deviceId || deviceId.length < 3) throw httpError(400, 'VALIDATION_ERROR', 'deviceId required (min 3 chars)');
    if (!name) throw httpError(400, 'VALIDATION_ERROR', 'name required');

    const plain = `${config.gatewayTokenPrefix}${randomSecret(24)}`;
    const tokenHash = hashToken(plain);

    const existing = await prisma.gatewayDevice.findUnique({ where: { deviceId } });
    let gw: any;
    if (existing) {
      gw = await prisma.gatewayDevice.update({
        where: { id: existing.id },
        data: {
          name,
          phoneNumber: b.phoneNumber ?? b.phone_number ?? existing.phoneNumber,
          platform: b.platform ?? existing.platform ?? 'android',
          appVersion: b.appVersion ?? b.app_version ?? existing.appVersion,
          manufacturer: b.manufacturer ?? existing.manufacturer,
          model: b.model ?? existing.model,
          androidVersion: b.androidVersion ?? b.android_version ?? existing.androidVersion,
          tokenHash,
          status: existing.status === 'DISABLED' || existing.status === 'BLOCKED' ? existing.status : 'ACTIVE',
          lastSeenAt: new Date(),
          lastIp: getClientIp(req),
        },
      });
    } else {
      gw = await prisma.gatewayDevice.create({
        data: {
          name,
          deviceId,
          phoneNumber: b.phoneNumber ?? b.phone_number ?? null,
          platform: b.platform ?? 'android',
          appVersion: b.appVersion ?? b.app_version ?? null,
          manufacturer: b.manufacturer ?? null,
          model: b.model ?? null,
          androidVersion: b.androidVersion ?? b.android_version ?? null,
          tokenHash,
          status: 'ACTIVE',
          lastSeenAt: new Date(),
          lastIp: getClientIp(req),
        },
      });
    }
    audit('gateway.register', req, 'gateway', gw.id, { deviceId });
    res.status(201).json({ id: gw.id, token: plain, name: gw.name, status: gatewayStatus(gw) });
  })
);

gatewaysRouter.post(
  '/heartbeat',
  requireGateway,
  rateLimit((req: any) => `hb:${req.gateway?.id}`, config.rateGatewayPerMinute, 60_000),
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const gw = await prisma.gatewayDevice.update({
      where: { id: req.gateway!.id },
      data: {
        battery: typeof b.battery === 'number' ? Math.max(0, Math.min(100, Math.round(b.battery))) : undefined,
        charging: typeof b.charging === 'boolean' ? b.charging : undefined,
        network: typeof b.network === 'string' ? String(b.network).slice(0, 50) : undefined,
        signalStrength: typeof b.signalStrength === 'number' ? b.signalStrength : typeof b.signal_strength === 'number' ? b.signal_strength : undefined,
        simCount: typeof b.simCount === 'number' ? b.simCount : typeof b.sim_count === 'number' ? b.sim_count : undefined,
        lastSeenAt: new Date(),
        lastIp: getClientIp(req),
        status: 'ACTIVE',
      },
    });
    res.json({ status: gatewayStatus(gw) });
  })
);

function dueFilter() {
  return {
    OR: [
      { status: 'QUEUED' as any },
      { status: 'RETRYING' as any },
      { status: 'SCHEDULED' as any, scheduledAt: { lte: new Date() } },
    ],
  };
}

gatewaysRouter.get(
  '/messages/pending',
  requireGateway,
  asyncHandler(async (req: AuthedRequest, res) => {
    const limit = Math.min(Number(req.query.limit ?? 10) || 10, 50);
    // Release this gateway's expired claims first (cheap, scoped)
    await prisma.smsJob.updateMany({
      where: { gatewayDeviceId: req.gateway!.id, status: 'CLAIMED' as any, claimExpiresAt: { lt: new Date() } },
      data: { status: 'QUEUED' as any, gatewayDeviceId: null, claimedAt: null, claimExpiresAt: null },
    });
    const messages = await prisma.smsJob.findMany({
      where: dueFilter() as any,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: limit,
    });
    res.json({ messages });
  })
);

gatewaysRouter.post(
  '/messages/claim',
  requireGateway,
  rateLimit((req: any) => `claim:${req.gateway?.id}`, config.rateGatewayPerMinute, 60_000),
  asyncHandler(async (req: AuthedRequest, res) => {
    const limit = Math.min(Number(req.body?.limit ?? 5) || 5, 20);
    const expiresAt = new Date(Date.now() + config.claimExpiryMinutes * 60_000);

    // Find candidates then claim one-by-one (avoids DB-specific SKIP LOCKED)
    const candidates = await prisma.smsJob.findMany({
      where: dueFilter() as any,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: limit * 3,
    });
    const claimed: any[] = [];
    for (const c of candidates) {
      if (claimed.length >= limit) break;
      try {
        const updated = await prisma.smsJob.updateMany({
          where: { id: c.id, status: c.status as any },
          data: {
            status: 'CLAIMED' as any,
            gatewayDeviceId: req.gateway!.id,
            claimedAt: new Date(),
            claimExpiresAt: expiresAt,
            attemptCount: { increment: 1 },
          },
        });
        if (updated.count === 1) {
          const full = await prisma.smsJob.findUnique({ where: { id: c.id } });
          if (full) claimed.push(full);
        }
      } catch {
        // race lost, continue
      }
    }
    await prisma.gatewayDevice.update({
      where: { id: req.gateway!.id },
      data: { lastSeenAt: new Date(), lastIp: getClientIp(req) },
    });
    res.json({ messages: claimed });
  })
);

const GATEWAY_STATUS_MAP: Record<string, string> = {
  SENDING: 'SENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  CLAIMED: 'CLAIMED',
  QUEUED: 'QUEUED',
};

gatewaysRouter.post(
  '/messages/:id/status',
  requireGateway,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { status, errorCode, errorMessage, providerReference } = req.body ?? {};
    const mapped = GATEWAY_STATUS_MAP[String(status ?? '').toUpperCase()];
    if (!mapped) throw httpError(400, 'VALIDATION_ERROR', 'Invalid status (SENDING|SENT|DELIVERED|FAILED|CLAIMED|QUEUED)');

    const job = await prisma.smsJob.findUnique({ where: { id: req.params.id } });
    if (!job) throw httpError(404, 'NOT_FOUND', 'Message not found');
    // Allow update if unclaimed or claimed by this gateway or already assigned to it
    if (job.gatewayDeviceId && job.gatewayDeviceId !== req.gateway!.id && (job.status as string) === 'CLAIMED') {
      throw httpError(409, 'CONFLICT', 'Message claimed by another gateway');
    }

    const now = new Date();
    let data: any = { gatewayDeviceId: req.gateway!.id };
    if (mapped === 'SENT') {
      data = { ...data, status: 'SENT', sentAt: now };
    } else if (mapped === 'DELIVERED') {
      data = { ...data, status: 'DELIVERED', sentAt: job.sentAt ?? now, deliveredAt: now };
    } else if (mapped === 'FAILED') {
      const attempts = (job.attemptCount ?? 1);
      const maxAttempts = (job as any).maxAttempts ?? config.smsMaxAttempts;
      if (attempts < maxAttempts) {
        const delays = config.smsRetryDelaysMs;
        const delay = delays[Math.min(attempts - 1, delays.length - 1)] ?? 60000;
        data = { ...data, status: 'RETRYING', lastErrorCode: errorCode ?? null, lastErrorMessage: errorMessage ?? null, scheduledAt: new Date(now.getTime() + delay), gatewayDeviceId: null, claimExpiresAt: null, claimedAt: null };
      } else {
        data = { ...data, status: 'FAILED', failedAt: now, lastErrorCode: errorCode ?? null, lastErrorMessage: errorMessage ?? null };
      }
    } else {
      data = { ...data, status: mapped as any };
    }
    if (providerReference) data.providerReference = String(providerReference).slice(0, 100);

    const updated = await prisma.smsJob.update({ where: { id: job.id }, data });

    // Record attempt
    await prisma.smsAttempt
      .create({
        data: {
          smsJobId: job.id,
          gatewayDeviceId: req.gateway!.id,
          gatewaySimId: (job as any).gatewaySimId ?? null,
          attemptNumber: (job.attemptCount ?? 1),
          status: mapped,
          errorCode: errorCode ?? null,
          errorMessage: errorMessage ?? null,
          startedAt: (job.claimedAt as any) ?? now,
          sentAt: mapped === 'SENT' || mapped === 'DELIVERED' ? now : null,
          completedAt: mapped === 'SENT' || mapped === 'DELIVERED' || mapped === 'FAILED' ? now : null,
        },
      })
      .catch(() => {});

    // Fire webhooks (async)
    const { fireWebhook } = await import('../webhooks');
    if (mapped === 'SENT') fireWebhook('sms.sent', updated);
    if (mapped === 'DELIVERED') fireWebhook('sms.delivered', updated);
    if (mapped === 'FAILED' && (updated.status as string) === 'FAILED') fireWebhook('sms.failed', updated);

    res.json({ success: true });
  })
);

gatewaysRouter.post(
  '/sims',
  requireGateway,
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const slotIndex = Number(b.slotIndex ?? b.slot_index);
    const phoneNumber = String(b.phoneNumber ?? b.phone_number ?? '').trim();
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 7) {
      throw httpError(400, 'VALIDATION_ERROR', 'slotIndex required (0-7)');
    }
    if (!phoneNumber) throw httpError(400, 'VALIDATION_ERROR', 'phoneNumber required');
    const sim = await prisma.gatewaySim.upsert({
      where: { gatewayDeviceId_slotIndex: { gatewayDeviceId: req.gateway!.id, slotIndex } },
      create: {
        gatewayDeviceId: req.gateway!.id,
        slotIndex,
        subscriptionId: b.subscriptionId ?? b.subscription_id ?? null,
        carrierName: b.carrierName ?? b.carrier_name ?? null,
        phoneNumber,
        countryCode: b.countryCode ?? b.country_code ?? null,
        isActive: b.isActive ?? b.is_active ?? true,
        isDefault: b.isDefault ?? b.is_default ?? false,
      },
      update: {
        subscriptionId: b.subscriptionId ?? b.subscription_id ?? undefined,
        carrierName: b.carrierName ?? b.carrier_name ?? undefined,
        phoneNumber,
        countryCode: b.countryCode ?? b.country_code ?? undefined,
        isActive: b.isActive ?? b.is_active ?? undefined,
        isDefault: b.isDefault ?? b.is_default ?? undefined,
      },
    });
    res.status(201).json(sim);
  })
);

gatewaysRouter.get(
  '/sims',
  requireGateway,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sims = await prisma.gatewaySim.findMany({
      where: { gatewayDeviceId: req.gateway!.id },
      orderBy: { slotIndex: 'asc' },
    });
    res.json(sims);
  })
);

// ---------- Admin management ----------

gatewaysRouter.get(
  '/',
  requireAdmin(),
  asyncHandler(async (_req, res) => {
    const gws = await prisma.gatewayDevice.findMany({ orderBy: { updatedAt: 'desc' }, take: 100, include: { sims: true } });
    res.json(gws.map((g) => publicGateway(g, (g as any).sims)));
  })
);

gatewaysRouter.get(
  '/:id',
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const g = await prisma.gatewayDevice.findUnique({ where: { id: req.params.id }, include: { sims: true } });
    if (!g) throw httpError(404, 'NOT_FOUND', 'Gateway not found');
    res.json(publicGateway(g, (g as any).sims));
  })
);

gatewaysRouter.patch(
  '/:id',
  requireAdmin(['SUPER_ADMIN', 'ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const g = await prisma.gatewayDevice.findUnique({ where: { id: req.params.id } });
    if (!g) throw httpError(404, 'NOT_FOUND', 'Gateway not found');
    const b = req.body ?? {};
    const updated = await prisma.gatewayDevice.update({
      where: { id: g.id },
      data: {
        name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : undefined,
        phoneNumber: typeof b.phoneNumber === 'string' ? b.phoneNumber : undefined,
        status: typeof b.status === 'string' && ['PENDING', 'ACTIVE', 'OFFLINE', 'DEGRADED', 'DISABLED', 'BLOCKED'].includes(b.status) ? b.status : undefined,
      },
      include: { sims: true },
    });
    audit('gateway.update', req, 'gateway', g.id, { status: (updated as any).status });
    res.json(publicGateway(updated, (updated as any).sims));
  })
);

async function setGatewayStatus(req: AuthedRequest, res: any, status: 'DISABLED' | 'ACTIVE') {
  const g = await prisma.gatewayDevice.findUnique({ where: { id: req.params.id } });
  if (!g) throw httpError(404, 'NOT_FOUND', 'Gateway not found');
  const updated = await prisma.gatewayDevice.update({ where: { id: g.id }, data: { status: status as any } });
  audit(`gateway.${status === 'ACTIVE' ? 'enable' : 'disable'}`, req, 'gateway', g.id, {});
  res.json(publicGateway(updated));
}

gatewaysRouter.post('/:id/disable', requireAdmin(['SUPER_ADMIN', 'ADMIN']), asyncHandler(async (req: AuthedRequest, res) => setGatewayStatus(req, res, 'DISABLED')));
gatewaysRouter.post('/:id/enable', requireAdmin(['SUPER_ADMIN', 'ADMIN']), asyncHandler(async (req: AuthedRequest, res) => setGatewayStatus(req, res, 'ACTIVE')));

gatewaysRouter.delete(
  '/:id',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const g = await prisma.gatewayDevice.findUnique({ where: { id: req.params.id } });
    if (!g) throw httpError(404, 'NOT_FOUND', 'Gateway not found');
    await prisma.gatewayDevice.delete({ where: { id: g.id } });
    audit('gateway.delete', req, 'gateway', g.id, {});
    res.status(204).send();
  })
);
