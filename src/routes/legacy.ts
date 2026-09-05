import { Router } from 'express';
import { prisma } from '../db';
import { config } from '../config';
import { asyncHandler, httpError, requireGateway, AuthedRequest, rateLimit, audit } from '../middleware';
import { hashToken, randomSecret, getClientIp, validatePhone, validateMessage, smsSegments } from '../utils';
import { fireWebhook } from '../webhooks';

export const legacyRouter = Router();

// POST /device/register {device_id, name?} -> gateway register compat
legacyRouter.post(
  '/device/register',
  rateLimit(() => 'legacy-register', 20, 60_000),
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const deviceId = String(b.device_id ?? b.deviceId ?? '').trim();
    const name = String(b.name ?? deviceId).trim();
    if (!deviceId) throw httpError(400, 'VALIDATION_ERROR', 'device_id required');
    const plain = `${config.gatewayTokenPrefix}${randomSecret(24)}`;
    const existing = await prisma.gatewayDevice.findUnique({ where: { deviceId } });
    let gw: any;
    if (existing) {
      gw = await prisma.gatewayDevice.update({
        where: { id: existing.id },
        data: { name: name || existing.name, tokenHash: hashToken(plain), status: 'ACTIVE' as any, lastSeenAt: new Date(), lastIp: getClientIp(req) },
      });
    } else {
      gw = await prisma.gatewayDevice.create({
        data: { name: name || deviceId, deviceId, tokenHash: hashToken(plain), status: 'ACTIVE' as any, platform: 'android', lastSeenAt: new Date(), lastIp: getClientIp(req) },
      });
    }
    audit('gateway.register', req, 'gateway', gw.id, { deviceId, legacy: true });
    res.status(201).json({ device_id: gw.deviceId, device_token: plain, status: 'active' });
  })
);

// POST /device/heartbeat {battery?, network?, sim_info?}
legacyRouter.post(
  '/device/heartbeat',
  requireGateway,
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    let simCount: number | undefined;
    if (typeof b.sim_info === 'string' && b.sim_info) {
      try {
        const parsed = JSON.parse(b.sim_info);
        if (Array.isArray(parsed)) simCount = parsed.length;
      } catch {
        simCount = undefined;
      }
    }
    await prisma.gatewayDevice.update({
      where: { id: req.gateway!.id },
      data: {
        battery: typeof b.battery === 'number' ? b.battery : undefined,
        network: typeof b.network === 'string' ? b.network : undefined,
        simCount: simCount as any,
        lastSeenAt: new Date(),
        lastIp: getClientIp(req),
        status: 'ACTIVE' as any,
      },
    });
    res.json({ status: 'ok' });
  })
);

// GET /sms/jobs/pending?limit=
legacyRouter.get(
  '/sms/jobs/pending',
  requireGateway,
  asyncHandler(async (req: AuthedRequest, res) => {
    const limit = Math.min(Number(req.query.limit ?? 5) || 5, 50);
    const jobs = await prisma.smsJob.findMany({
      where: { OR: [{ status: 'QUEUED' as any }, { status: 'RETRYING' as any }] } as any,
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    res.json(jobs.map((j) => ({ id: j.id, phone_number: (j as any).recipient, message: (j as any).message })));
  })
);

async function legacyMark(req: AuthedRequest, status: 'SENDING' | 'SENT' | 'FAILED') {
  const job = await prisma.smsJob.findUnique({ where: { id: req.params.id } });
  if (!job) throw httpError(404, 'NOT_FOUND', 'Job not found');
  const now = new Date();
  const error = (req.body as any)?.error ?? (req.body as any)?.errorMessage ?? null;
  let data: any = { gatewayDeviceId: req.gateway!.id };
  if (status === 'SENT') data = { ...data, status: 'SENT', sentAt: now };
  else if (status === 'SENDING') data = { ...data, status: 'CLAIMED', claimedAt: now, claimExpiresAt: new Date(now.getTime() + config.claimExpiryMinutes * 60000) };
  else {
    const attempts = (job.attemptCount ?? 0) + 1;
    if (attempts < config.smsMaxAttempts) data = { ...data, status: 'RETRYING', attemptCount: attempts, lastErrorMessage: error ? String(error) : null };
    else data = { ...data, status: 'FAILED', attemptCount: attempts, failedAt: now, lastErrorMessage: error ? String(error) : null };
  }
  const updated = await prisma.smsJob.update({ where: { id: job.id }, data });
  if (status === 'SENT') fireWebhook('sms.sent', updated);
  if (status === 'FAILED' && (updated.status as string) === 'FAILED') fireWebhook('sms.failed', updated);
  return updated;
}

legacyRouter.post('/sms/jobs/:id/processing', requireGateway, asyncHandler(async (req: AuthedRequest, res) => res.json(await legacyMark(req, 'SENDING'))));
legacyRouter.post('/sms/jobs/:id/sent', requireGateway, asyncHandler(async (req: AuthedRequest, res) => res.json(await legacyMark(req, 'SENT'))));
legacyRouter.post(
  '/sms/jobs/:id/failed',
  requireGateway,
  asyncHandler(async (req: AuthedRequest, res) => res.json(await legacyMark(req, 'FAILED')))
);

// GET /sms/stats -> {pending,sent,failed,processing}
legacyRouter.get(
  '/sms/stats',
  requireGateway,
  asyncHandler(async (_req, res) => {
    const [pending, sent, failed, processing] = await Promise.all([
      prisma.smsJob.count({ where: { status: { in: ['QUEUED', 'SCHEDULED'] as any } } }),
      prisma.smsJob.count({ where: { status: 'SENT' as any } }),
      prisma.smsJob.count({ where: { status: 'FAILED' as any } }),
      prisma.smsJob.count({ where: { status: { in: ['CLAIMED', 'SENDING', 'RETRYING'] as any } } }),
    ]);
    res.json({ pending, sent, failed, processing });
  })
);

// Legacy open SMS intake (deprecated): POST /sms {to,message}
// Kept for backward compat but rate-limited per IP. Prefer POST /api/v1/sms with API key.
legacyRouter.post(
  '/sms',
  rateLimit((req) => `legacy-sms:${req.ip}`, 30, 60_000),
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const phone = validatePhone(b.to ?? b.recipient);
    if (!phone.ok) throw httpError(400, 'VALIDATION_ERROR', phone.error!);
    const msg = validateMessage(b.message);
    if (!msg.ok) throw httpError(400, 'VALIDATION_ERROR', msg.error!);
    const { encoding, segmentCount } = smsSegments(String(b.message));
    const job = await prisma.smsJob.create({
      data: {
        recipient: phone.normalized,
        message: String(b.message),
        status: 'QUEUED' as any,
        priority: 'NORMAL' as any,
        maxAttempts: config.smsMaxAttempts,
        segmentCount,
        encoding,
      },
    });
    audit('sms.create', req, 'sms', job.id, { to: job.recipient, legacy: true });
    fireWebhook('sms.created', job);
    res.status(201).json({ id: job.id, status: job.status, recipient: job.recipient });
  })
);

legacyRouter.get(
  '/sms',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100);
    const jobs = await prisma.smsJob.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    res.json(jobs);
  })
);

legacyRouter.get(
  '/sms/:id',
  asyncHandler(async (req, res) => {
    const job = await prisma.smsJob.findUnique({ where: { id: req.params.id } });
    if (!job) throw httpError(404, 'NOT_FOUND', 'Job not found');
    res.json(job);
  })
);

legacyRouter.post(
  '/sms/:id/cancel',
  asyncHandler(async (req: AuthedRequest, res) => {
    const job = await prisma.smsJob.findUnique({ where: { id: req.params.id } });
    if (!job) throw httpError(404, 'NOT_FOUND', 'Job not found');
    if (!['QUEUED', 'SCHEDULED', 'RETRYING'].includes(job.status as string)) {
      throw httpError(409, 'CONFLICT', `Cannot cancel in ${job.status}`);
    }
    const updated = await prisma.smsJob.update({ where: { id: job.id }, data: { status: 'CANCELLED' as any } });
    audit('sms.cancel', req, 'sms', job.id, { legacy: true });
    res.json(updated);
  })
);
