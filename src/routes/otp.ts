import { Router } from 'express';
import { prisma } from '../db';
import { config } from '../config';
import { asyncHandler, httpError, requireAdminOrApiKey, audit, rateLimit, AuthedRequest } from '../middleware';
import { validatePhone, sha256 } from '../utils';
import { createOne } from './sms';
import { fireWebhook } from '../webhooks';

export const otpRouter = Router();

const PURPOSE_RE = /^[a-zA-Z0-9_\-:.]{1,64}$/;

function generateCode(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 10);
  return out;
}

function minutesFromSeconds(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

function cleanOtpSession(session: any) {
  return {
    id: session.id,
    phone: session.phone,
    purpose: session.purpose,
    status: session.status,
    expiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null,
    verifiedAt: session.verifiedAt ? new Date(session.verifiedAt).toISOString() : null,
    attempts: session.attempts ?? 0,
  };
}

// POST /api/v1/otp/send { phone, purpose, code?, ttlSeconds? }
// Issues (or re-issues) an OTP and hands it to the SMS gateway pipeline.
// Idempotent per (phone, purpose): while a PENDING, unexpired session exists,
// no new SMS is dispatched.
otpRouter.post(
  '/send',
  requireAdminOrApiKey,
  rateLimit((req: any) => `otp:${req.apiKey?.id ?? req.ip}`, 10, 60_000),
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const phoneCheck = validatePhone(b.phone);
    if (!phoneCheck.ok) throw httpError(400, 'VALIDATION_ERROR', phoneCheck.error!);
    const purpose = String(b.purpose ?? '').trim();
    if (!PURPOSE_RE.test(purpose)) throw httpError(400, 'VALIDATION_ERROR', 'purpose required (alphanumeric, max 64 chars)');

    const ttlSeconds = Number(b.ttlSeconds ?? config.otpTtlSeconds);
    const ttl = Number.isFinite(ttlSeconds) && ttlSeconds >= 60 ? Math.floor(ttlSeconds) : config.otpTtlSeconds;

    const existing = await prisma.otpSession.findFirst({
      where: { phone: phoneCheck.normalized, purpose, status: 'PENDING' },
    });
    const now = new Date();
    if (existing && new Date(existing.expiresAt) > now) {
      return res.json({ idempotent: true, session: cleanOtpSession(existing) });
    }

    const code = String(b.code ?? generateCode(6));
    const session = await prisma.otpSession.create({
      data: {
        phone: phoneCheck.normalized,
        purpose,
        codeHash: sha256(code),
        status: 'PENDING',
        expiresAt: new Date(Date.now() + ttl * 1000),
        attempts: 0,
      },
    });

    const { job } = await createOne({
      to: phoneCheck.normalized,
      message: `Your ${purpose} verification code is ${code}. It expires in ${minutesFromSeconds(ttl)} minutes.`,
      priority: 'HIGH',
      idempotencyKey: `otp_${session.id}`,
      externalId: null,
      metadata: { purpose, otpSessionId: session.id },
      apiKeyId: (req as any).apiKey?.id ?? null,
      actorReq: req,
      provider: b.provider,
    });

    audit('otp.send', req, 'otp_session', session.id, { phone: session.phone, purpose });
    fireWebhook('sms.created', job);
    return res.status(201).json({
      id: session.id,
      sessionId: session.id,
      phone: session.phone,
      purpose,
      status: session.status,
      expiresAt: session.expiresAt.toISOString(),
      jobId: job.id,
      idempotent: false,
    });
  })
);

// POST /api/v1/otp/verify { phone, purpose, code }
otpRouter.post(
  '/verify',
  requireAdminOrApiKey,
  rateLimit((req: any) => `otp:${req.apiKey?.id ?? req.ip}`, 20, 60_000),
  asyncHandler(async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const phoneCheck = validatePhone(b.phone);
    if (!phoneCheck.ok) throw httpError(400, 'VALIDATION_ERROR', phoneCheck.error!);
    const purpose = String(b.purpose ?? '').trim();
    if (!PURPOSE_RE.test(purpose)) throw httpError(400, 'VALIDATION_ERROR', 'purpose required (alphanumeric, max 64 chars)');

    const code = String(b.code ?? '').trim();
    const session = await prisma.otpSession.findFirst({
      where: { phone: phoneCheck.normalized, purpose, status: 'PENDING' },
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
    return res.json({ verified: true, code: 'OTP_VERIFIED', sessionId: updated.id });
  })
);

// GET /api/v1/otp/status?phone=&purpose= -> current session state (no code)
otpRouter.get(
  '/status',
  requireAdminOrApiKey,
  asyncHandler(async (req: AuthedRequest, res) => {
    const phoneCheck = validatePhone(req.query?.phone);
    if (!phoneCheck.ok) throw httpError(400, 'VALIDATION_ERROR', phoneCheck.error!);
    const purpose = String(req.query?.purpose ?? '').trim();
    if (!PURPOSE_RE.test(purpose)) throw httpError(400, 'VALIDATION_ERROR', 'purpose required (alphanumeric, max 64 chars)');

    const session = await prisma.otpSession.findFirst({
      where: { phone: phoneCheck.normalized, purpose, status: { in: ['PENDING', 'VERIFIED'] } },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ session: session ? cleanOtpSession(session) : null });
  })
);
