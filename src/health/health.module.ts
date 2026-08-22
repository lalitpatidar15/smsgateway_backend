import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../config/prisma.service';
import { RedisService } from '../config/redis.service';

@Module({
  controllers: [HealthController],
  providers: [PrismaService, RedisService],
})
export class HealthModule {}
