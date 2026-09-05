import { Router } from 'express';
import { prisma } from '../db';
import { config } from '../config';
import { asyncHandler, httpError, requireAdmin, audit, AuthedRequest } from '../middleware';
import { hashToken, randomSecret } from '../utils';

export const apiKeysRouter = Router();

function publicKey(k: any, plain?: string) {
  const base: any = {
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    status: k.status,
    permissions: k.permissions ?? [],
    rateLimitPerMinute: k.rateLimitPerMinute,
    dailyLimit: k.dailyLimit,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt ?? null,
    revokedAt: k.revokedAt ?? null,
  };
  if (plain) base.key = plain;
  return base;
}

apiKeysRouter.post(
  '/',
  requireAdmin(['SUPER_ADMIN', 'ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { name, permissions, rateLimitPerMinute, dailyLimit } = req.body ?? {};
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      throw httpError(400, 'VALIDATION_ERROR', 'Name required (min 2 chars)');
    }
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
      },
    });
    audit('apikey.create', req, 'api_key', created.id, { name: created.name });
    res.status(201).json(publicKey(created, plain));
  })
);

apiKeysRouter.get(
  '/',
  requireAdmin(),
  asyncHandler(async (_req, res) => {
    const keys = await prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    res.json(keys.map((k) => publicKey(k)));
  })
);

apiKeysRouter.get(
  '/:id',
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const k = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
    if (!k) throw httpError(404, 'NOT_FOUND', 'API key not found');
    res.json(publicKey(k));
  })
);

apiKeysRouter.post(
  '/:id/revoke',
  requireAdmin(['SUPER_ADMIN', 'ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const k = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
    if (!k) throw httpError(404, 'NOT_FOUND', 'API key not found');
    const updated = await prisma.apiKey.update({
      where: { id: k.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    audit('apikey.revoke', req, 'api_key', k.id, {});
    res.json(publicKey(updated));
  })
);

apiKeysRouter.delete(
  '/:id',
  requireAdmin(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const k = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
    if (!k) throw httpError(404, 'NOT_FOUND', 'API key not found');
    await prisma.apiKey.delete({ where: { id: k.id } });
    audit('apikey.delete', req, 'api_key', k.id, {});
    res.status(204).send();
  })
);
