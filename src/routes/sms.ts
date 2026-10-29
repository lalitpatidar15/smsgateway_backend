import { Router } from 'express';
import { prisma } from '../db';
import { config } from '../config';
import { asyncHandler, httpError, requireApiKey, requireAdminOrApiKey, audit, AuthedRequest, rateLimit } from '../middleware';
import { validatePhone, validateMessage, smsSegments, paginate } from '../utils';
import { fireWebhook } from '../webhooks';
import { getSmsProvider } from '../providers';

export const smsRouter = Router();

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

async function checkLimits(apiKeyId: string | null, recipient: string) {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (apiKeyId) {
    const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
    const dailyLimit = key?.dailyLimit ?? config.dailySmsPerApiKey;
    const todayCount = await prisma.smsJob.count({ where: { apiKeyId, createdAt: { gte: dayAgo } } });
    if (todayCount >= dailyLimit) throw httpError(429, 'DAILY_LIMIT', `Daily limit reached (${dailyLimit})`);
  }
  // recipient per hour anti-spam
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const recent = await prisma.smsJob.count({ where: { recipient, createdAt: { gte: hourAgo } } });
  if (recent >= config.rateRecipientPerHour) {
    throw httpError(429, 'RATE_LIMITED', `Too many messages to this recipient (max ${config.rateRecipientPerHour}/hour)`);
  }
}

export async function createOne(opts: {
  to: unknown;
  message: unknown;
  scheduledAt?: unknown;
  priority?: unknown;
  idempotencyKey?: unknown;
  externalId?: unknown;
  metadata?: unknown;
  apiKeyId: string | null;
  actorReq: AuthedRequest;
  provider?: unknown;
}) {
  const phone = validatePhone(opts.to);
  if (!phone.ok) throw httpError(400, 'VALIDATION_ERROR', phone.error!);
  const msg = validateMessage(opts.message);
  if (!msg.ok) throw httpError(400, 'VALIDATION_ERROR', msg.error!);
  const message = String(opts.message);

  let priority = 'NORMAL';
  if (opts.priority && PRIORITIES.includes(String(opts.priority).toUpperCase())) {
    priority = String(opts.priority).toUpperCase();
  }

  if (opts.idempotencyKey) {
    const key = String(opts.idempotencyKey);
    const existing = await prisma.smsJob.findUnique({ where: { idempotencyKey: key } });
    if (existing) return { job: existing, idempotent: true };
  }

  if (opts.externalId) {
    const ext = String(opts.externalId);
    const existing = await prisma.smsJob.findUnique({ where: { externalId: ext } });
    if (existing) throw httpError(409, 'CONFLICT', 'externalId already exists');
  }

  let scheduledAt: Date | null = null;
  let status: any = 'QUEUED';
  if (opts.scheduledAt) {
    const d = new Date(String(opts.scheduledAt));
    if (isNaN(d.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid scheduledAt');
    if (d.getTime() > Date.now() + 5000) {
      scheduledAt = d;
      status = 'SCHEDULED';
    }
  }

  await checkLimits(opts.apiKeyId, phone.normalized);

  const suppression = await prisma.suppressionList.findFirst({
    where: {
      phone: phone.normalized,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (suppression) {
    throw httpError(400, 'SUPPRESSED', 'Recipient is suppressed');
  }

  const { encoding, segmentCount } = smsSegments(message);

  let job: any;
  if (opts.provider) {
    const provider = getSmsProvider(String(opts.provider));
    const result = await provider!.send({ to: phone.normalized, message, idempotencyKey: opts.idempotencyKey ? String(opts.idempotencyKey) : undefined });
    status = 'SENT';
    job = await prisma.smsJob.create({
      data: {
        recipient: phone.normalized,
        message,
        status: 'SENT' as any,
        priority: priority as any,
        apiKeyId: opts.apiKeyId,
        idempotencyKey: opts.idempotencyKey ? String(opts.idempotencyKey) : null,
        externalId: opts.externalId ? String(opts.externalId) : null,
        scheduledAt,
        maxAttempts: config.smsMaxAttempts,
        segmentCount,
        encoding,
        metadata: (opts.metadata as any) ?? undefined,
        providerReference: result.providerMessageId,
        sentAt: new Date(),
      },
    });
  } else {
    job = await prisma.smsJob.create({
      data: {
        recipient: phone.normalized,
        message,
        status,
        priority: priority as any,
        apiKeyId: opts.apiKeyId,
        idempotencyKey: opts.idempotencyKey ? String(opts.idempotencyKey) : null,
        externalId: opts.externalId ? String(opts.externalId) : null,
        scheduledAt,
        maxAttempts: config.smsMaxAttempts,
        segmentCount,
        encoding,
        metadata: (opts.metadata as any) ?? undefined,
      },
    });
  }
  audit('sms.create', opts.actorReq, 'sms', job.id, { to: job.recipient, status });
  fireWebhook('sms.created', job);
  return { job, idempotent: false };
}

smsRouter.post(
  '/',
  requireApiKey,
  rateLimit((req: any) => `sms:${req.apiKey?.id ?? req.ip}`, config.rateSmsPerMinute, 60_000),
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const { job, idempotent } = await createOne({
      to: b.to ?? b.recipient ?? b.phone_number,
      message: b.message ?? b.body,
      scheduledAt: b.scheduledAt ?? b.scheduled_at,
      priority: b.priority,
      idempotencyKey: b.idempotencyKey ?? b.idempotency_key,
      externalId: b.externalId ?? b.external_id,
      metadata: b.metadata,
      apiKeyId: req.apiKey!.id,
      actorReq: req,
      provider: b.provider,
    });
    res.status(201).json({ id: job.id, status: job.status, ...(idempotent ? { idempotent: true } : {}) });
  })
);

smsRouter.post(
  '/bulk',
  requireApiKey,
  asyncHandler(async (req: AuthedRequest, res) => {
    const messages = (req.body?.messages ?? []) as any[];
    if (!Array.isArray(messages) || messages.length === 0) throw httpError(400, 'VALIDATION_ERROR', 'messages[] required');
    if (messages.length > config.bulkMax) throw httpError(400, 'VALIDATION_ERROR', `Max ${config.bulkMax} messages per bulk request`);
    const out: any[] = [];
    for (const m of messages) {
      try {
        const { job, idempotent } = await createOne({
          to: m.to,
          message: m.message,
          scheduledAt: m.scheduledAt,
          priority: m.priority,
          idempotencyKey: m.idempotencyKey,
          externalId: undefined,
          metadata: undefined,
          apiKeyId: req.apiKey!.id,
          actorReq: req,
          provider: m.provider,
        });
        out.push({ id: job.id, status: job.status, ...(idempotent ? { idempotent: true } : {}) });
      } catch (e: any) {
        out.push({ status: 'FAILED', error: e.message });
      }
    }
    res.status(201).json({ messages: out, total: out.length });
  })
);

smsRouter.get(
  '/',
  requireAdminOrApiKey,
  asyncHandler(async (req: AuthedRequest, res) => {
    const q: any = req.query ?? {};
    const { page, limit, skip, take } = paginate(q.page, q.limit);
    const where: any = {};
    if ((req as any).apiKey) where.apiKeyId = (req as any).apiKey.id;
    if (q.status && typeof q.status === 'string') where.status = q.status.toUpperCase();
    if (q.recipient && typeof q.recipient === 'string') where.recipient = { contains: q.recipient };
    if (q.gatewayId && typeof q.gatewayId === 'string') where.gatewayDeviceId = q.gatewayId;
    if (q.from) {
      const d = new Date(String(q.from));
      if (!isNaN(d.getTime())) where.createdAt = { ...(where.createdAt ?? {}), gte: d };
    }
    if (q.to) {
      const d = new Date(String(q.to));
      if (!isNaN(d.getTime())) where.createdAt = { ...(where.createdAt ?? {}), lte: d };
    }
    const [total, data] = await Promise.all([
      prisma.smsJob.count({ where }),
      prisma.smsJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { attempts: { orderBy: { startedAt: 'desc' }, take: 10 } } }),
    ]);
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

smsRouter.get(
  '/incoming',
  requireAdminOrApiKey,
  asyncHandler(async (req: AuthedRequest, res) => {
    const q: any = req.query ?? {};
    const { page, limit, skip, take } = paginate(q.page, q.limit);
    const where: any = {};
    if (q.sender && typeof q.sender === 'string') where.sender = { contains: q.sender };
    if (q.gatewayId && typeof q.gatewayId === 'string') where.gatewayDeviceId = q.gatewayId;
    if (q.unread === 'true') where.readAt = null;
    if (q.unread === 'false') where.readAt = { not: null };
    if (q.from) {
      const d = new Date(String(q.from));
      if (!isNaN(d.getTime())) where.receivedAt = { ...(where.receivedAt ?? {}), gte: d };
    }
    if (q.to) {
      const d = new Date(String(q.to));
      if (!isNaN(d.getTime())) where.receivedAt = { ...(where.receivedAt ?? {}), lte: d };
    }
    const [total, data] = await Promise.all([
      prisma.inboundSms.count({ where }),
      prisma.inboundSms.findMany({ where, orderBy: { receivedAt: 'desc' }, skip, take }),
    ]);
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

smsRouter.post(
  '/incoming/:id/read',
  requireAdminOrApiKey,
  asyncHandler(async (req: AuthedRequest, res) => {
    const msg = await prisma.inboundSms.findUnique({ where: { id: req.params.id } });
    if (!msg) throw httpError(404, 'NOT_FOUND', 'Message not found');
    const updated = msg.readAt
      ? msg
      : await prisma.inboundSms.update({ where: { id: msg.id }, data: { readAt: new Date() } });
    res.json(updated);
  })
);

smsRouter.get(
  '/:id',
  requireAdminOrApiKey,
  asyncHandler(async (req: AuthedRequest, res) => {
    const job = await prisma.smsJob.findUnique({ where: { id: req.params.id }, include: { attempts: { orderBy: { startedAt: 'desc' } } } });
    if (!job) throw httpError(404, 'NOT_FOUND', 'Message not found');
    if ((req as any).apiKey && (job as any).apiKeyId !== (req as any).apiKey.id) {
      throw httpError(403, 'FORBIDDEN', 'Not your message');
    }
    res.json(job);
  })
);

smsRouter.post(
  '/:id/cancel',
  requireAdminOrApiKey,
  asyncHandler(async (req: AuthedRequest, res) => {
    const job = await prisma.smsJob.findUnique({ where: { id: req.params.id } });
    if (!job) throw httpError(404, 'NOT_FOUND', 'Message not found');
    if ((req as any).apiKey && (job as any).apiKeyId !== (req as any).apiKey.id) {
      throw httpError(403, 'FORBIDDEN', 'Not your message');
    }
    if (!['QUEUED', 'SCHEDULED', 'RETRYING'].includes(job.status as string)) {
      throw httpError(409, 'CONFLICT', `Cannot cancel message in ${job.status} state`);
    }
    const updated = await prisma.smsJob.update({ where: { id: job.id }, data: { status: 'CANCELLED' as any } });
    audit('sms.cancel', req, 'sms', job.id, {});
    fireWebhook('sms.cancelled', updated);
    res.json(updated);
  })
);
