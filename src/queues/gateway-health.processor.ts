import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from './queue.service';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class GatewayHealthProcessor implements OnModuleInit {
  private readonly logger = new Logger(GatewayHealthProcessor.name);

  constructor(
    private queueService: QueueService,
    private prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.queueService.registerWorker('gateway-health', this.processHealthCheck.bind(this));
  }

  private async processHealthCheck(job: any) {
    const onlineThreshold = parseInt(process.env.HEARTBEAT_ONLINE_THRESHOLD_MS || '60000');
    const degradedThreshold = parseInt(process.env.HEARTBEAT_DEGRADED_THRESHOLD_MS || '300000');
    const now = new Date();

    await this.prisma.$executeRaw`
      UPDATE gateway_devices
      SET status = 'OFFLINE'
      WHERE status IN ('ACTIVE', 'DEGRADED')
      AND last_seen_at < ${new Date(now.getTime() - degradedThreshold)}
    `;

    await this.prisma.$executeRaw`
      UPDATE gateway_devices
      SET status = 'DEGRADED'
      WHERE status = 'ACTIVE'
      AND last_seen_at < ${new Date(now.getTime() - onlineThreshold)}
      AND last_seen_at >= ${new Date(now.getTime() - degradedThreshold)}
    `;

    return { checked: true };
  }
}
