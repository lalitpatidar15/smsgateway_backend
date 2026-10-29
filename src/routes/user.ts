import { Router } from 'express';
import { prisma } from '../db';
import { config } from '../config';
import { asyncHandler, httpError, requireUser, audit, AuthedRequest } from '../middleware';
import { paginate } from '../utils';
import { createOne } from './sms';
import { fireWebhook } from '../webhooks';

export const userRouter = Router();

// User dashboard stats
userRouter.get(
  '/dashboard',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const orgId = req.user!.organizationId;

    const [total, gateways, today, queued, sent, delivered, failed] = await Promise.all([
      prisma.gatewayDevice.count(),
      prisma.gatewayDevice.findMany({ select: { lastSeenAt: true, status: true } }),
      prisma.smsJob.count({ where: { userId: req.user!.id, createdAt: { gte: startOfDay } } }),
      prisma.smsJob.count({ where: { userId: req.user!.id, status: { in: ['QUEUED', 'SCHEDULED', 'CLAIMED', 'RETRYING'] as any } } }),
      prisma.smsJob.count({ where: { userId: req.user!.id, status: 'SENT' as any } }),
      prisma.smsJob.count({ where: { userId: req.user!.id, status: 'DELIVERED' as any } }),
      prisma.smsJob.count({ where: { userId: req.user!.id, status: 'FAILED' as any } }),
    ]);

    let online = 0;
    for (const g of gateways) {
      if ((g as any).status === 'DISABLED' || (g as any).status === 'BLOCKED') continue;
      if (g.lastSeenAt && now.getTime() - new Date(g.lastSeenAt).getTime() <= config.heartbeatOnlineMs) online++;
    }

    res.json({
      gateways: { total, online, offline: total - online },
      sms: { today, queued, sent, delivered, failed },
    });
  })
);

// User profile
userRouter.get(
  '/profile',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role, organizationId: user.organizationId, createdAt: user.createdAt });
  })
);

userRouter.patch(
  '/profile',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { name } = req.body ?? {};
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { name: name?.trim() || null },
    });
    audit('user.profile.update', req, 'user', user.id, { name: user.name });
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role, organizationId: user.organizationId });
  })
);

userRouter.post(
  '/profile/password',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) throw httpError(400, 'VALIDATION_ERROR', 'Current and new password required');
    if (newPassword.length < 8) throw httpError(400, 'VALIDATION_ERROR', 'New password must be at least 8 characters');

    const bcrypt = await import('bcryptjs');
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');

    const ok = await (bcrypt as any).compare(String(currentPassword), user.password);
    if (!ok) throw httpError(401, 'UNAUTHORIZED', 'Current password is incorrect');

    const hash = await (bcrypt as any).hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hash } });
    audit('user.password.change', req, 'user', user.id, {});
    res.json({ ok: true });
  })
);

// User API keys
userRouter.post(
  '/api-keys',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { name, permissions, rateLimitPerMinute, dailyLimit } = req.body ?? {};
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      throw httpError(400, 'VALIDATION_ERROR', 'Name required (min 2 chars)');
    }
    const { randomSecret, hashToken } = await import('../utils');
    const secret = randomSecret(24);
    const plain = `${config.apiKeyPrefix}${secret}`;
    const created = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        keyHash: hashToken(plain),
        keyPrefix: plain.slice(0, 12),
        status: 'ACTIVE',
        permissions: Array.isArray(permissions) ? permissions.map(String) : [],
        rateLimitPerMinute: Number(rateLimitPerMinute) > 0 ? Number(rateLimitPerMinute) : config.rateSmsPerMinute,
        dailyLimit: Number(dailyLimit) > 0 ? Number(dailyLimit) : config.dailySmsPerApiKey,
        userId: req.user!.id,
      },
    });
    audit('apikey.create', req, 'api_key', created.id, { name: created.name });
    res.status(201).json({ ...created, key: plain });
  })
);

userRouter.get(
  '/api-keys',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const keys = await prisma.apiKey.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
    res.json(keys);
  })
);

userRouter.get(
  '/api-keys/:id',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const key = await prisma.apiKey.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!key) throw httpError(404, 'NOT_FOUND', 'API key not found');
    res.json(key);
  })
);

userRouter.post(
  '/api-keys/:id/revoke',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const key = await prisma.apiKey.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!key) throw httpError(404, 'NOT_FOUND', 'API key not found');
    const updated = await prisma.apiKey.update({
      where: { id: key.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    audit('apikey.revoke', req, 'api_key', key.id, {});
    res.json(updated);
  })
);

userRouter.delete(
  '/api-keys/:id',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const key = await prisma.apiKey.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!key) throw httpError(404, 'NOT_FOUND', 'API key not found');
    await prisma.apiKey.delete({ where: { id: key.id } });
    audit('apikey.delete', req, 'api_key', key.id, {});
    res.status(204).send();
  })
);

// User SMS send (reuse sms router logic but scoped to user)
userRouter.post(
  '/sms',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    // Find user's first API key or create a synthetic one for tracking
    const apiKey = await prisma.apiKey.findFirst({ where: { userId: req.user!.id, status: 'ACTIVE' } });

    const { job } = await createOne({
      to: b.to ?? b.recipient ?? b.phone_number,
      message: b.message ?? b.body,
      scheduledAt: b.scheduledAt ?? b.scheduled_at,
      priority: b.priority,
      idempotencyKey: b.idempotencyKey ?? b.idempotency_key,
      externalId: b.externalId ?? b.external_id,
      metadata: b.metadata,
      apiKeyId: apiKey?.id ?? null,
      actorReq: req,
      provider: b.provider,
    });
    res.status(201).json({ id: job.id, status: job.status });
  })
);

userRouter.post(
  '/sms/bulk',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const messages = (req.body?.messages ?? []) as any[];
    if (!Array.isArray(messages) || messages.length === 0) throw httpError(400, 'VALIDATION_ERROR', 'messages[] required');
    if (messages.length > config.bulkMax) throw httpError(400, 'VALIDATION_ERROR', `Max ${config.bulkMax} messages per bulk request`);

    const apiKey = await prisma.apiKey.findFirst({ where: { userId: req.user!.id, status: 'ACTIVE' } });
    const out: any[] = [];
    for (const m of messages) {
      try {
        const { job } = await createOne({
          to: m.to,
          message: m.message,
          scheduledAt: m.scheduledAt,
          priority: m.priority,
          idempotencyKey: m.idempotencyKey,
          externalId: undefined,
          metadata: undefined,
          apiKeyId: apiKey?.id ?? null,
          actorReq: req,
          provider: m.provider,
        });
        out.push({ id: job.id, status: job.status });
      } catch (e: any) {
        out.push({ status: 'FAILED', error: e.message });
      }
    }
    res.status(201).json({ messages: out, total: out.length });
  })
);

userRouter.get(
  '/sms',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const q: any = req.query ?? {};
    const { page, limit, skip, take } = paginate(q.page, q.limit);
    const where: any = { userId: req.user!.id };
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

userRouter.get(
  '/sms/:id',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const job = await prisma.smsJob.findFirst({ where: { id: req.params.id, userId: req.user!.id }, include: { attempts: { orderBy: { startedAt: 'desc' } } } });
    if (!job) throw httpError(404, 'NOT_FOUND', 'Message not found');
    res.json(job);
  })
);

userRouter.post(
  '/sms/:id/cancel',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const job = await prisma.smsJob.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!job) throw httpError(404, 'NOT_FOUND', 'Message not found');
    if (!['QUEUED', 'SCHEDULED', 'RETRYING'].includes(job.status as string)) {
      throw httpError(409, 'CONFLICT', `Cannot cancel message in ${job.status} state`);
    }
    const updated = await prisma.smsJob.update({ where: { id: job.id }, data: { status: 'CANCELLED' as any } });
    audit('sms.cancel', req, 'sms', job.id, {});
    fireWebhook('sms.cancelled', updated);
    res.json(updated);
  })
);

// User OTP
userRouter.post(
  '/otp/send',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const { validatePhone } = await import('../utils');
    const phoneCheck = validatePhone(b.phone);
    if (!phoneCheck.ok) throw httpError(400, 'VALIDATION_ERROR', phoneCheck.error!);
    const purpose = String(b.purpose ?? '').trim();
    if (!purpose) throw httpError(400, 'VALIDATION_ERROR', 'purpose required');

    const ttlSeconds = Number(b.ttlSeconds ?? config.otpTtlSeconds);
    const ttl = Number.isFinite(ttlSeconds) && ttlSeconds >= 60 ? Math.floor(ttlSeconds) : config.otpTtlSeconds;

    const existing = await prisma.otpSession.findFirst({
      where: { phone: phoneCheck.normalized, purpose, status: 'PENDING', userId: req.user!.id },
    });
    const now = new Date();
    if (existing && new Date(existing.expiresAt) > now) {
      return res.json({ idempotent: true, sessionId: existing.id });
    }

    const { generateCode, sha256, minutesFromSeconds } = await import('../utils');
    const code = String(b.code ?? generateCode(6));
    const session = await prisma.otpSession.create({
      data: {
        phone: phoneCheck.normalized,
        purpose,
        codeHash: sha256(code),
        status: 'PENDING',
        expiresAt: new Date(Date.now() + ttl * 1000),
        attempts: 0,
        userId: req.user!.id,
      },
    });

    const { job } = await createOne({
      to: phoneCheck.normalized,
      message: `Your ${purpose} verification code is ${code}. It expires in ${minutesFromSeconds(ttl)} minutes.`,
      priority: 'HIGH',
      idempotencyKey: `otp_${session.id}`,
      externalId: null,
      metadata: { purpose, otpSessionId: session.id },
      apiKeyId: null,
      actorReq: req,
      provider: b.provider,
    });

    audit('otp.send', req, 'otp_session', session.id, { phone: session.phone, purpose });
    fireWebhook('sms.created', job);
    res.status(201).json({ sessionId: session.id, jobId: job.id, phone: session.phone, purpose, expiresAt: session.expiresAt.toISOString(), idempotent: false });
  })
);

userRouter.post(
  '/otp/verify',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const { validatePhone, sha256 } = await import('../utils');
    const phoneCheck = validatePhone(b.phone);
    if (!phoneCheck.ok) throw httpError(400, 'VALIDATION_ERROR', phoneCheck.error!);
    const purpose = String(b.purpose ?? '').trim();
    if (!purpose) throw httpError(400, 'VALIDATION_ERROR', 'purpose required');

    const code = String(b.code ?? '').trim();
    const session = await prisma.otpSession.findFirst({
      where: { phone: phoneCheck.normalized, purpose, status: 'PENDING', userId: req.user!.id },
    });

    if (!session) {
      return res.json({ verified: false, code: 'OTP_NOT_FOUND', message: 'No active OTP session for this purpose' });
    }
    if (new Date(session.expiresAt) <= new Date()) {
      await prisma.otpSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } });
      return res.json({ verified: false, code: 'OTP_EXPIRED', message: 'OTP expired' });
    }
    if (session.status === 'VERIFIED') {
      return res.json({ verified: true, code: 'OTP_ALREADY_USED', message: 'OTP already verified' });
    }
    if ((session.attempts ?? 0) >= config.otpMaxAttempts) {
      await prisma.otpSession.update({ where: { id: session.id }, data: { status: 'BLOCKED' } });
      return res.json({ verified: false, code: 'OTP_BLOCKED', message: 'Too many failed attempts' });
    }

    if (sha256(code) !== session.codeHash) {
      const attempts = (session.attempts ?? 0) + 1;
      const blocked = attempts >= config.otpMaxAttempts;
      await prisma.otpSession.update({ where: { id: session.id }, data: { attempts, status: blocked ? 'BLOCKED' : 'PENDING' } });
      return res.json({ verified: false, code: blocked ? 'OTP_BLOCKED' : 'OTP_INVALID', attemptsRemaining: Math.max(0, config.otpMaxAttempts - attempts) });
    }

    const updated = await prisma.otpSession.update({
      where: { id: session.id },
      data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedBy: 'app' },
    });
    audit('otp.verify', req, 'otp_session', session.id, { phone: session.phone, purpose, verified: true });
    res.json({ verified: true, code: 'OTP_VERIFIED', sessionId: updated.id });
  })
);

userRouter.get(
  '/otp/status',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { validatePhone } = await import('../utils');
    const phoneCheck = validatePhone(req.query?.phone);
    if (!phoneCheck.ok) throw httpError(400, 'VALIDATION_ERROR', phoneCheck.error!);
    const purpose = String(req.query?.purpose ?? '').trim();
    if (!purpose) throw httpError(400, 'VALIDATION_ERROR', 'purpose required');

    const session = await prisma.otpSession.findFirst({
      where: { phone: phoneCheck.normalized, purpose, status: { in: ['PENDING', 'VERIFIED'] }, userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ session: session ? { id: session.id, phone: session.phone, purpose: session.purpose, status: session.status, expiresAt: session.expiresAt, verifiedAt: session.verifiedAt, attempts: session.attempts } : null });
  })
);

userRouter.get(
  '/otp/sessions',
  requireUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sessions = await prisma.otpSession.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(sessions.map((s) => ({
      id: s.id,
      phone: s.phone,
      purpose: s.purpose,
      status: s.status,
      expiresAt: s.expiresAt,
      verifiedAt: s.verifiedAt,
      attempts: s.attempts,
      createdAt: s.createdAt,
    })));
  })
);