import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from './queue.service';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class ScheduledProcessor implements OnModuleInit {
  private readonly logger = new Logger(ScheduledProcessor.name);

  constructor(
    private queueService: QueueService,
    private prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.queueService.registerWorker('scheduled-sms', this.processScheduled.bind(this));
  }

  private async processScheduled(job: any) {
    const result = await this.prisma.smsJob.updateMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: new Date() },
      },
      data: { status: 'QUEUED' },
    });

    this.logger.log(`Promoted ${result.count} scheduled messages`);
    return { promoted: result.count };
  }
}
