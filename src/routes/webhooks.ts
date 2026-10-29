import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../db';
import { asyncHandler, httpError, requireAdmin, audit, AuthedRequest, rateLimit } from '../middleware';
import { createEndpoint, fireWebhook } from '../webhooks';
import { config } from '../config';

export const webhooksRouter = Router();

webhooksRouter.post(
  '/endpoints',
  requireAdmin(['SUPER_ADMIN', 'ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { url, events, gatewayDeviceId } = req.body ?? {};
    if (!url || typeof url !== 'string') throw httpError(400, 'VALIDATION_ERROR', 'url required');
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('bad protocol');
    } catch {
      throw httpError(400, 'VALIDATION_ERROR', 'Invalid webhook URL');
    }
    if (gatewayDeviceId) {
      const gw = await prisma.gatewayDevice.findUnique({ where: { id: String(gatewayDeviceId) } });
      if (!gw) throw httpError(404, 'NOT_FOUND', 'Gateway not found');
    }
    const ep = await createEndpoint(url, Array.isArray(events) ? events.map(String) : [], gatewayDeviceId ?? null);
    audit('webhook.create', req, 'webhook', ep.id, { url });
    res.status(201).json(ep);
  })
);

webhooksRouter.get(
  '/endpoints',
  requireAdmin(),
  asyncHandler(async (_req, res) => {
    const eps = await prisma.webhookEndpoint.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    // Never leak full secret list? Return as-is for admin (needed for setup).
    res.json(eps);
  })
);

webhooksRouter.delete(
  '/endpoints/:id',
  requireAdmin(['SUPER_ADMIN', 'ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ep = await prisma.webhookEndpoint.findUnique({ where: { id: req.params.id } });
    if (!ep) throw httpError(404, 'NOT_FOUND', 'Endpoint not found');
    await prisma.webhookEndpoint.delete({ where: { id: ep.id } });
    audit('webhook.delete', req, 'webhook', ep.id, {});
    res.status(204).send();
  })
);

// POST /api/v1/webhooks/twilio/status -> Twilio provider status callback (form-encoded)
webhooksRouter.post(
  '/twilio/status',
  rateLimit(() => 'twilio-callback', 100, 60_000),
  asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    const twilioSignature = req.headers['x-twilio-signature'];
    const authToken = config.twilioAuthToken;
    let signatureValid = true;
    if (authToken) {
      const sig = String(twilioSignature ?? '');
      const params = Object.keys(b)
        .filter((k) => b[k] !== null && b[k] !== undefined)
        .sort()
        .map((k) => `${k}=${encodeURIComponent(String(b[k]))}`)
        .join('&');
      const url = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
      const payload = params ? `${url}&${params}` : url;
      const expected = crypto.createHmac('sha256', authToken).update(payload).digest('base64');
      const a = Buffer.from(expected);
      const z = Buffer.from(sig);
      signatureValid = sig.length === a.length && crypto.timingSafeEqual(a, z);
    }
    if (!signatureValid) {
      return res.status(403).json({ received: false });
    }
    const sid = String(b.MessageSid ?? b.messageSid ?? '');
    const status = String(b.MessageStatus ?? b.messageStatus ?? '').toLowerCase();
    if (!sid) return res.json({ received: true });
    const job = await prisma.smsJob.findFirst({ where: { providerReference: sid } });
    if (job && (job.status as string) !== 'SENT') {
      const now = new Date();
      if (status === 'delivered') {
        const updated = await prisma.smsJob.update({ where: { id: job.id }, data: { status: 'DELIVERED', deliveredAt: now } });
        fireWebhook('sms.delivered', updated);
      } else if (status === 'failed') {
        const attempts = (job.attemptCount ?? 0) + 1;
        const maxAttempts = (job.maxAttempts ?? config.smsMaxAttempts) as number;
        const errorCode = String(b.ErrorCode ?? b.errorCode ?? '');
        const errorMessage = String(b.ErrorMessage ?? b.errorMessage ?? 'twilio send failed');
        if (attempts < maxAttempts) {
          await prisma.smsJob.update({
            where: { id: job.id },
            data: { status: 'RETRYING', attemptCount: attempts, lastErrorCode: errorCode, lastErrorMessage: errorMessage, scheduledAt: new Date(Date.now() + 30000) },
          });
        } else {
          const updated = await prisma.smsJob.update({ where: { id: job.id }, data: { status: 'FAILED', failedAt: now, lastErrorCode: errorCode, lastErrorMessage: errorMessage } });
          fireWebhook('sms.failed', updated);
        }
      } else if (status === 'sent' || status === 'queued') {
        const updated = await prisma.smsJob.update({ where: { id: job.id }, data: { status: 'SENT', sentAt: now } });
        fireWebhook('sms.sent', updated);
      }
    }
    res.json({ received: true });
  })
);
