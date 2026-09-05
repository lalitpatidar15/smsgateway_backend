import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import morgan from 'morgan';
import { config } from './config';
import { logger } from './logger';
import { prisma, checkPostgres } from './db';
import { requestIdMiddleware, notFound, errorHandler, rateLimit } from './middleware';
import { metricsMiddleware } from './metrics';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { apiKeysRouter } from './routes/apiKeys';
import { gatewaysRouter } from './routes/gateways';
import { smsRouter } from './routes/sms';
import { adminRouter } from './routes/admin';
import { webhooksRouter } from './routes/webhooks';
import { legacyRouter } from './routes/legacy';
import { startScheduler } from './scheduler';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const origins = config.corsOrigins === '*' ? '*' : config.corsOrigins.split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: origins === '*' ? true : (origins as string[]),
    credentials: false,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(requestIdMiddleware);
app.use((req, res, next) => {
  res.setHeader('X-Request-Id', (req as any).requestId);
  next();
});

// HTTP request logging (morgan -> winston). Skips LB health probes to cut noise.
morgan.token('request-id', (req: any) => req.requestId || '-');
app.use(
  morgan(':method :url :status :response-time ms - :res[content-length] :request-id', {
    skip: (req: any) => req.originalUrl === '/health',
    stream: { write: (msg: string) => logger.info('http', { line: msg.trim() }) },
  })
);

// In-memory API monitoring (feeds GET /api/v1/admin/metrics).
app.use(metricsMiddleware);

// Global soft rate limit (abuse floor)
app.use(rateLimit(() => 'global', 600, 60_000));

// Render / LB health (no /api prefix)
app.get('/health', async (req, res) => {
  const postgres = await checkPostgres();
  res.status(postgres === 'ok' ? 200 : 503).json({
    status: postgres === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    requestId: (req as any).requestId,
  });
});

// Versioned API
app.use('/api/v1', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/admin/api-keys', apiKeysRouter);
app.use('/api/v1/gateways', gatewaysRouter);
app.use('/api/v1/sms', smsRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/webhooks', webhooksRouter);

// Legacy compat for current mobile builds + old integrations
app.use('/', legacyRouter);

app.use(notFound);
app.use(errorHandler);

async function ensureAdmin() {
  try {
    const count = await prisma.adminUser.count();
    if (count === 0) {
      const hash = await (bcrypt as any).hash(config.adminPassword, 10);
      await prisma.adminUser.create({
        data: { email: config.adminEmail.toLowerCase(), password: hash, name: 'Admin', role: 'SUPER_ADMIN' as any },
      });
      logger.info('default admin created', { email: config.adminEmail });
    }
  } catch (e) {
    logger.warn('ensureAdmin failed', { error: (e as Error).message });
  }
}

const PORT = config.port;
const server = app.listen(PORT, async () => {
  logger.info(`SMS Gateway Backend listening on ${PORT}`, { env: config.env });
  const pg = await checkPostgres();
  logger.info(`postgres: ${pg}`);
  if (pg !== 'ok') logger.error('Database not reachable — check DATABASE_URL');
  await ensureAdmin();
  startScheduler();
});

function shutdown(signal: string) {
  logger.info(`received ${signal}, shutting down`);
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error('unhandledRejection', { error: String(err) }));

export default app;
