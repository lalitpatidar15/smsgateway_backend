import { Router } from 'express';
import { prisma } from '../db';
import { config } from '../config';
import { asyncHandler, httpError, requireAdmin, audit, AuthedRequest } from '../middleware';
import { paginate } from '../utils';
import { fireWebhook } from '../webhooks';
import { metricsSnapshot } from '../metrics';

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

    const [total, gateways, today, queued, sent, delivered, failed] = await Promise.all([
      prisma.gatewayDevice.count(),
      prisma.gatewayDevice.findMany({ select: { lastSeenAt: true, status: true } }),
      prisma.smsJob.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.smsJob.count({ where: { status: { in: ['QUEUED', 'SCHEDULED', 'CLAIMED', 'RETRYING'] as any } } }),
      prisma.smsJob.count({ where: { status: 'SENT' as any } }),
      prisma.smsJob.count({ where: { status: 'DELIVERED' as any } }),
      prisma.smsJob.count({ where: { status: 'FAILED' as any } }),
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
