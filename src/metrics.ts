import { Request, Response, NextFunction } from 'express';

// Lightweight in-memory API monitoring (no external infra).
// Records per-route counts, error counts and latency stats.

interface RouteStats {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

const routes = new Map<string, RouteStats>();
const MAX_ROUTES = 500;
let totalRequests = 0;
let totalErrors = 0;
const startedAt = Date.now();

function routeKey(req: Request): string {
  // Keyed off the raw URL with ID-like segments collapsed, so success and
  // error responses for the same endpoint always land in one row.
  // (req.baseUrl is unreliable here: Express restores it while unwinding errors.)
  const raw = String((req as any).originalUrl || req.url || '').split('?')[0];
  const collapsed = raw
    .split('/')
    .map((seg) => (/^([0-9a-f-]{8,}|[0-9]+)$/i.test(seg) ? ':id' : seg))
    .join('/');
  return `${req.method} ${collapsed || '<unmatched>'}`;
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    try {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const key = routeKey(req);
      let s = routes.get(key);
      if (!s) {
        if (routes.size >= MAX_ROUTES) {
          const oldest = routes.keys().next().value;
          if (oldest) routes.delete(oldest);
        }
        s = { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
        routes.set(key, s);
      }
      s.count += 1;
      s.totalMs += ms;
      if (ms > s.maxMs) s.maxMs = ms;
      totalRequests += 1;
      if (res.statusCode >= 500) {
        s.errors += 1;
        totalErrors += 1;
      }
    } catch {
      // monitoring must never break requests
    }
  });
  next();
}

export function metricsSnapshot() {
  const mem = process.memoryUsage();
  const list = Array.from(routes.entries()).map(([route, s]) => ({
    route,
    count: s.count,
    errors: s.errors,
    avgMs: s.count > 0 ? Math.round((s.totalMs / s.count) * 100) / 100 : 0,
    maxMs: Math.round(s.maxMs * 100) / 100,
  }));
  list.sort((a, b) => b.count - a.count);
  return {
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    totalRequests,
    totalErrors,
    memory: {
      rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
    },
    routes: list,
    timestamp: new Date().toISOString(),
  };
}
