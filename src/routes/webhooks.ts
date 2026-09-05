import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler, httpError, requireAdmin, audit, AuthedRequest } from '../middleware';
import { createEndpoint } from '../webhooks';

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
