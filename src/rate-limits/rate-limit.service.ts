import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../config/redis.service';

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(
    private redis: RedisService,
    private configService: ConfigService,
  ) {}

  async checkApiKeyLimit(apiKeyId: string): Promise<{ allowed: boolean; remaining: number }> {
    const limit = this.configService.get('RATE_LIMIT_SMS_PER_MINUTE', 100);
    const key = `rate:apikey:${apiKeyId}:${Math.floor(Date.now() / 60000)}`;
    const count = await this.redis.incrWithExpiry(key, 60);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  }

  async checkRecipientLimit(recipient: string): Promise<{ allowed: boolean; remaining: number }> {
    const limit = this.configService.get('RATE_LIMIT_RECIPIENT_PER_HOUR', 5);
    const key = `rate:recipient:${recipient}:${Math.floor(Date.now() / 3600000)}`;
    const count = await this.redis.incrWithExpiry(key, 3600);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  }

  async checkGatewayLimit(gatewayId: string): Promise<{ allowed: boolean; remaining: number }> {
    const limit = this.configService.get('RATE_LIMIT_GATEWAY_PER_MINUTE', 20);
    const key = `rate:gateway:${gatewayId}:${Math.floor(Date.now() / 60000)}`;
    const count = await this.redis.incrWithExpiry(key, 60);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  }

  async checkDailyQuota(apiKeyId: string): Promise<{ allowed: boolean; remaining: number }> {
    const limit = this.configService.get('DAILY_SMS_LIMIT_PER_API_KEY', 500);
    const today = new Date().toISOString().split('T')[0];
    const key = `quota:daily:${apiKeyId}:${today}`;
    const count = await this.redis.incrWithExpiry(key, 86400);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  }

  async checkDailyGatewayQuota(gatewayId: string): Promise<{ allowed: boolean; remaining: number }> {
    const limit = this.configService.get('DAILY_SMS_LIMIT_PER_GATEWAY', 2000);
    const today = new Date().toISOString().split('T')[0];
    const key = `quota:gateway:${gatewayId}:${today}`;
    const count = await this.redis.incrWithExpiry(key, 86400);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  }
}
