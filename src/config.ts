import 'dotenv/config';

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.length > 0 ? v : fallback;
}

function list(key: string, fallback: number[]): number[] {
  const v = process.env[key];
  if (!v) return fallback;
  return v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export const config = {
  port: num('APP_PORT', num('PORT', 3000)),
  env: str('APP_ENV', str('NODE_ENV', 'development')),
  databaseUrl: str('DATABASE_URL', ''),
  jwtSecret: str('JWT_SECRET', 'change-me-in-production-min-32-chars'),
  jwtExpiresIn: str('JWT_EXPIRES_IN', '24h'),
  adminEmail: str('ADMIN_DEFAULT_EMAIL', 'admin@example.com'),
  adminPassword: str('ADMIN_DEFAULT_PASSWORD', 'admin123'),
  gatewayTokenPrefix: str('GATEWAY_TOKEN_PREFIX', 'gw_'),
  apiKeyPrefix: str('API_KEY_PREFIX', 'sg_live_'),
  heartbeatOnlineMs: num('HEARTBEAT_ONLINE_THRESHOLD_MS', 60000),
  heartbeatDegradedMs: num('HEARTBEAT_DEGRADED_THRESHOLD_MS', 300000),
  claimExpiryMinutes: num('CLAIM_EXPIRY_MINUTES', 2),
  smsMaxAttempts: num('SMS_MAX_ATTEMPTS', 3),
  smsRetryDelaysMs: list('SMS_RETRY_DELAYS_MS', [30000, 120000, 600000]),
  rateSmsPerMinute: num('RATE_LIMIT_SMS_PER_MINUTE', 100),
  rateRecipientPerHour: num('RATE_LIMIT_RECIPIENT_PER_HOUR', 5),
  rateGatewayPerMinute: num('RATE_LIMIT_GATEWAY_PER_MINUTE', 20),
  dailySmsPerApiKey: num('DAILY_SMS_LIMIT_PER_API_KEY', 500),
  dailySmsPerGateway: num('DAILY_SMS_LIMIT_PER_GATEWAY', 2000),
  bulkMax: num('BULK_SMS_MAX_MESSAGES', 100),
  webhookMaxAttempts: num('WEBHOOK_MAX_ATTEMPTS', 5),
  webhookRetryDelaysMs: list('WEBHOOK_RETRY_DELAYS_MS', [60000, 300000, 1800000, 7200000]),
  corsOrigins: str('CORS_ORIGINS', '*'),
  redisUrl: str('REDIS_URL', ''),
  redisHost: str('REDIS_HOST', 'localhost'),
  redisPort: num('REDIS_PORT', 6379),
  redisPassword: str('REDIS_PASSWORD', ''),
};

export const isProd = config.env === 'production';
