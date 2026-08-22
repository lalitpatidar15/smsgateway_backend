import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { validate } from './config/env.validation';
import { PrismaModule } from './config/prisma.module';
import { RedisModule } from './config/redis.module';
import { AuthModule } from './auth/auth.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { GatewaysModule } from './gateways/gateways.module';
import { SmsModule } from './sms/sms.module';
import { DeliveryModule } from './delivery/delivery.module';
import { QueueModule } from './queues/queue.module';
import { RateLimitModule } from './rate-limits/rate-limit.module';
import { WebhookModule } from './webhooks/webhook.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    AuthModule,
    ApiKeysModule,
    GatewaysModule,
    SmsModule,
    DeliveryModule,
    QueueModule,
    RateLimitModule,
    WebhookModule,
    AdminModule,
    AuditModule,
    HealthModule,
  ],
})
export class AppModule {}
