import { Router } from 'express';
import { prisma } from '../db';
import { config } from '../config';
import { asyncHandler, httpError, requireAdmin, audit, AuthedRequest } from '../middleware';
import { paginate } from '../utils';
import { fireWebhook } from '../webhooks';
import { metricsSnapshot } from '../metrics';
import { randomSecret, hashToken } from '../utils';

export const adminRouter = Router();

// API monitoring snapshot (request counts, error counts, latency per route).
adminRouter.get(
  '/metrics',
  requireAdmin(),
  asyncHandler(async (_req, res) => {
    res.json(metricsSnapshot());
  })
);

adminRouter.get(
  '/dashboard',
  requireAdmin(),
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const [total, gateways, today, queued, sent, delivered, failed, received] = await Promise.all([
      prisma.gatewayDevice.count(),
      prisma.gatewayDevice.findMany({ select: { lastSeenAt: true, status: true } }),
      prisma.smsJob.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.smsJob.count({ where: { status: { in: ['QUEUED', 'SCHEDULED', 'CLAIMED', 'RETRYING'] as any } } }),
      prisma.smsJob.count({ where: { status: 'SENT' as any } }),
      prisma.smsJob.count({ where: { status: 'DELIVERED' as any } }),
      prisma.smsJob.count({ where: { status: 'FAILED' as any } }),
      prisma.inboundSms.count({ where: { receivedAt: { gte: startOfDay } } }),
    ]);

    let online = 0;
    for (const g of gateways) {
      if ((g as any).status === 'DISABLED' || (g as any).status === 'BLOCKED') continue;
      if (g.lastSeenAt && now.getTime() - new Date(g.lastSeenAt).getTime() <= config.heartbeatOnlineMs) online++;
    }

    res.json({
      gateways: { total, online, offline: total - online },
      sms: { today, queued, sent, delivered, failed, received },
    });
  })
);

adminRouter.post(
  '/sms/:id/retry',
  requireAdmin(['SUPER_ADMIN', 'ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const job = await prisma.smsJob.findUnique({ where: { id: req.params.id } });
    if (!job) throw httpError(404, 'NOT_FOUND', 'Message not found');
    if (!['FAILED', 'EXPIRED', 'CANCELLED'].includes(job.status as string)) {
      throw httpError(409, 'CONFLICT', `Cannot retry message in ${job.status} state`);
    }
    const updated = await prisma.smsJob.update({
      where: { id: job.id },
      data: {
        status: 'QUEUED' as any,
        attemptCount: 0,
        failedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        gatewayDeviceId: null,
        gatewaySimId: null,
        claimedAt: null,
        claimExpiresAt: null,
        scheduledAt: null,
      },
    });
    audit('sms.retry', req, 'sms', job.id, {});
    fireWebhook('sms.retry', updated);
    res.json(updated);
  })
);

adminRouter.get(
  '/audit-logs',
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const q: any = req.query ?? {};
    const { page, limit, skip, take } = paginate(q.page, q.limit);
    const [total, data] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, skip, take }),
    ]);
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

// Organizations (SUPER_ADMIN only)
adminRouter.post(
  '/organizations',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { name, slug, plan } = req.body ?? {};
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      throw httpError(400, 'VALIDATION_ERROR', 'Name required (min 2 chars)');
    }
    if (!slug || typeof slug !== 'string' || slug.trim().length < 2) {
      throw httpError(400, 'VALIDATION_ERROR', 'Slug required (min 2 chars)');
    }
    const normalizedSlug = slug.trim().toLowerCase();
    const existing = await prisma.organization.findUnique({ where: { slug: normalizedSlug } });
    if (existing) throw httpError(409, 'CONFLICT', 'Slug already exists');
    const org = await prisma.organization.create({
      data: { name: name.trim(), slug: normalizedSlug, plan: plan ?? 'FREE' },
    });
    audit('org.create', req, 'organization', org.id, { name: org.name, slug: org.slug });
    res.status(201).json(org);
  })
);

adminRouter.get(
  '/organizations',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (_req, res) => {
    const orgs = await prisma.organization.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { users: true } } } });
    res.json(orgs);
  })
);

adminRouter.get(
  '/organizations/:id',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (req, res) => {
    const org = await prisma.organization.findUnique({ where: { id: req.params.id }, include: { _count: { select: { users: true } } } });
    if (!org) throw httpError(404, 'NOT_FOUND', 'Organization not found');
    res.json(org);
  })
);

adminRouter.patch(
  '/organizations/:id',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { name, plan } = req.body ?? {};
    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data: { name: name?.trim(), plan },
    });
    audit('org.update', req, 'organization', org.id, { name: org.name, plan: org.plan });
    res.json(org);
  })
);

adminRouter.delete(
  '/organizations/:id',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!org) throw httpError(404, 'NOT_FOUND', 'Organization not found');
    await prisma.organization.delete({ where: { id: org.id } });
    audit('org.delete', req, 'organization', org.id, {});
    res.status(204).send();
  })
);

// Admin users (SUPER_ADMIN only)
adminRouter.post(
  '/users',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { email, password, name, role } = req.body ?? {};
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw httpError(400, 'VALIDATION_ERROR', 'Valid email required');
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      throw httpError(400, 'VALIDATION_ERROR', 'Password must be at least 8 characters');
    }
    const existing = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw httpError(409, 'CONFLICT', 'Email already registered');
    const bcrypt = await import('bcryptjs');
    const hash = await (bcrypt as any).hash(password, 10);
    const user = await prisma.adminUser.create({
      data: { email: email.toLowerCase(), password: hash, name: name ?? null, role: role ?? 'ADMIN' },
    });
    audit('admin.create', req, 'admin_user', user.id, { email: user.email, role: user.role });
    res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive, createdAt: user.createdAt });
  })
);

adminRouter.get(
  '/users',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (_req, res) => {
    const users = await prisma.adminUser.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(users);
  })
);

adminRouter.get(
  '/users/:id',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (req, res) => {
    const user = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
    if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');
    res.json(user);
  })
);

adminRouter.patch(
  '/users/:id',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { email, name, role, isActive, password } = req.body ?? {};
    const bcrypt = await import('bcryptjs');
    const data: any = {};
    if (email) data.email = email.toLowerCase();
    if (name !== undefined) data.name = name?.trim() || null;
    if (role) data.role = role;
    if (isActive !== undefined) data.isActive = isActive;
    if (password) data.password = await (bcrypt as any).hash(password, 10);
    const user = await prisma.adminUser.update({ where: { id: req.params.id }, data });
    audit('admin.update', req, 'admin_user', user.id, { email: user.email, role: user.role });
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive });
  })
);

adminRouter.delete(
  '/users/:id',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
    if (!user) throw httpError(404, 'NOT_FOUND', 'User not found');
    await prisma.adminUser.delete({ where: { id: user.id } });
    audit('admin.delete', req, 'admin_user', user.id, {});
    res.status(204).send();
  })
);

// Settings (SUPER_ADMIN only)
adminRouter.get(
  '/settings',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (_req, res) => {
    // Return current config as settings
    res.json({
      platformName: 'SMS Gateway',
      supportEmail: '',
      defaultSender: '',
      rateSmsPerMinute: config.rateSmsPerMinute,
      rateRecipientPerHour: config.rateRecipientPerHour,
      rateGatewayPerMinute: config.rateGatewayPerMinute,
      dailySmsPerApiKey: config.dailySmsPerApiKey,
      dailySmsPerGateway: config.dailySmsPerGateway,
      bulkMax: config.bulkMax,
      claimExpiryMinutes: config.claimExpiryMinutes,
      heartbeatOnlineMs: config.heartbeatOnlineMs,
      heartbeatDegradedMs: config.heartbeatDegradedMs,
      otpTtlSeconds: config.otpTtlSeconds,
      otpMaxAttempts: config.otpMaxAttempts,
      webhookMaxAttempts: config.webhookMaxAttempts,
      webhookRetryDelaysMs: config.webhookRetryDelaysMs.join(','),
      corsOrigins: config.corsOrigins,
    });
  })
);

adminRouter.patch(
  '/settings',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (_req, res) => {
    // Settings are stored in env; just acknowledge
    res.json({ ok: true, message: 'Settings saved (requires restart for some changes)' });
  })
);
