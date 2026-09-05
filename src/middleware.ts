import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { prisma } from './db';
import { hashToken, getClientIp } from './utils';
import { logger } from './logger';

export interface AuthedRequest extends Request {
  requestId: string;
  // Declared explicitly (instead of relying on express's Request generics)
  // so builds are deterministic across @types/express versions.
  body: any;
  params: any;
  query: any;
  admin?: { id: string; email: string; role: string };
  apiKey?: { id: string; name: string; permissions: string[] };
  gateway?: { id: string; deviceId: string; name: string };
}

export function requestIdMiddleware(req: any, _res: any, next: NextFunction) {
  req.requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  next();
}

export function asyncHandler(fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next);
  };
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Not found', requestId: ( _req as any).requestId },
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const requestId = (req as any).requestId;
  // Prisma known errors
  if (err?.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'Duplicate value', requestId },
    });
  }
  if (err?.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Record not found', requestId },
    });
  }
  const status = err?.status || err?.statusCode || 500;
  logger.error('request error', { requestId, status, message: err?.message, stack: err?.stack });
  res.status(status >= 400 && status < 600 ? status : 500).json({
    success: false,
    error: {
      code: err?.code || 'INTERNAL_ERROR',
      message: status === 500 ? 'Internal server error' : err?.message || 'Error',
      requestId,
    },
  });
}

export function httpError(status: number, code: string, message: string): any {
  const e: any = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

export const requireAdmin = (roles?: string[]) =>
  asyncHandler(async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) throw httpError(401, 'UNAUTHORIZED', 'Missing bearer token');
    let payload: any;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw httpError(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }
    const user = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw httpError(401, 'UNAUTHORIZED', 'Account disabled');
    if (roles && roles.length > 0 && !roles.includes(user.role)) {
      throw httpError(403, 'FORBIDDEN', 'Insufficient role');
    }
    req.admin = { id: user.id, email: user.email, role: user.role };
    next();
  });

export const requireApiKey = asyncHandler(async (req: AuthedRequest, _res: Response, next: NextFunction) => {
  const token = bearer(req);
  if (!token || !token.startsWith(config.apiKeyPrefix)) {
    throw httpError(401, 'UNAUTHORIZED', 'Missing or invalid API key');
  }
  const hash = hashToken(token);
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
  if (!key || key.status !== 'ACTIVE') throw httpError(401, 'UNAUTHORIZED', 'API key revoked or unknown');
  // touch lastUsedAt async (don't block)
  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  req.apiKey = { id: key.id, name: key.name, permissions: key.permissions ?? [] };
  (req as any).apiKeyRecord = key;
  next();
});

export const requireGateway = asyncHandler(async (req: AuthedRequest, _res: Response, next: NextFunction) => {
  const token = bearer(req);
  if (!token || !token.startsWith(config.gatewayTokenPrefix)) {
    throw httpError(401, 'UNAUTHORIZED', 'Missing or invalid gateway token');
  }
  const hash = hashToken(token);
  const gw = await prisma.gatewayDevice.findUnique({ where: { tokenHash: hash } });
  if (!gw) throw httpError(401, 'UNAUTHORIZED', 'Unknown gateway token');
  if (gw.status === 'DISABLED' || gw.status === 'BLOCKED') {
    throw httpError(403, 'FORBIDDEN', `Gateway ${gw.status.toLowerCase()}`);
  }
  req.gateway = { id: gw.id, deviceId: gw.deviceId, name: gw.name };
  (req as any).gatewayRecord = gw;
  next();
});

// Accept admin JWT OR api key (for endpoints usable by both, e.g. SMS list)
export const requireAdminOrApiKey = asyncHandler(async (req: AuthedRequest, _res: Response, next: NextFunction) => {
  const token = bearer(req);
  if (!token) throw httpError(401, 'UNAUTHORIZED', 'Missing bearer token');
  if (token.startsWith(config.apiKeyPrefix)) {
    const hash = hashToken(token);
    const key = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
    if (!key || key.status !== 'ACTIVE') throw httpError(401, 'UNAUTHORIZED', 'API key revoked');
    req.apiKey = { id: key.id, name: key.name, permissions: key.permissions ?? [] };
    (req as any).apiKeyRecord = key;
    return next();
  }
  let payload: any;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw httpError(401, 'UNAUTHORIZED', 'Invalid token');
  }
  const user = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw httpError(401, 'UNAUTHORIZED', 'Account disabled');
  req.admin = { id: user.id, email: user.email, role: user.role };
  next();
});

// ---- Simple in-memory rate limiter (per-process). For multi-instance use Redis. ----
const buckets = new Map<string, number[]>();

export function rateLimit(keyFn: (req: Request) => string, max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (max <= 0) return next();
    const key = keyFn(req);
    const now = Date.now();
    const arr = buckets.get(key) ?? [];
    const fresh = arr.filter((t) => now - t < windowMs);
    if (fresh.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: (req as any).requestId },
      });
    }
    fresh.push(now);
    buckets.set(key, fresh);
    next();
  };
}

export function audit(action: string, req: AuthedRequest, resourceType?: string, resourceId?: string, metadata?: any) {
  const actorType = req.admin ? 'admin' : req.apiKey ? 'api_key' : req.gateway ? 'gateway' : 'system';
  const actorId = req.admin?.id ?? req.apiKey?.id ?? req.gateway?.id ?? null;
  prisma.auditLog
    .create({
      data: {
        actorType,
        actorId,
        action,
        resourceType: resourceType ?? null,
        resourceId: resourceId ?? null,
        ip: getClientIp(req as any),
        metadata: metadata ?? undefined,
      },
    })
    .catch((e) => logger.warn('audit failed', { error: (e as Error).message }));
}
