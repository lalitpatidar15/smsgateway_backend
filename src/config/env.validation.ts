import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('24h'),
  APP_PORT: z.coerce.number().default(3000),
  APP_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ADMIN_DEFAULT_EMAIL: z.string().email(),
  ADMIN_DEFAULT_PASSWORD: z.string().min(6),
  GATEWAY_TOKEN_PREFIX: z.string().default('gw_'),
  API_KEY_PREFIX: z.string().default('sg_live_'),
  HEARTBEAT_ONLINE_THRESHOLD_MS: z.coerce.number().default(60000),
  HEARTBEAT_DEGRADED_THRESHOLD_MS: z.coerce.number().default(300000),
  CLAIM_EXPIRY_MINUTES: z.coerce.number().default(2),
  SMS_MAX_ATTEMPTS: z.coerce.number().default(3),
  SMS_RETRY_DELAYS_MS: z.string().default('30000,120000,600000'),
  RATE_LIMIT_SMS_PER_MINUTE: z.coerce.number().default(100),
  RATE_LIMIT_RECIPIENT_PER_HOUR: z.coerce.number().default(5),
  RATE_LIMIT_GATEWAY_PER_MINUTE: z.coerce.number().default(20),
  DAILY_SMS_LIMIT_PER_API_KEY: z.coerce.number().default(500),
  DAILY_SMS_LIMIT_PER_GATEWAY: z.coerce.number().default(2000),
  BULK_SMS_MAX_MESSAGES: z.coerce.number().default(100),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().default(5),
  WEBHOOK_RETRY_DELAYS_MS: z.string().default('60000,300000,1800000,7200000'),
  CORS_ORIGINS: z.string().optional(),
});

export function validate(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }
  return result.data;
}
