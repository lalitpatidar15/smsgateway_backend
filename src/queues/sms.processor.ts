import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from './queue.service';
import { PrismaService } from '../config/prisma.service';
import { GatewaysService } from '../gateways/gateways.service';

@Injectable()
export class SmsProcessor implements OnModuleInit {
  private readonly logger = new Logger(SmsProcessor.name);

  constructor(
    private queueService: QueueService,
    private prisma: PrismaService,
    private gatewaysService: GatewaysService,
  ) {}

  onModuleInit() {
    this.queueService.registerWorker('sms-dispatch', this.processDispatch.bind(this));
    this.queueService.registerWorker('sms-retry', this.processRetry.bind(this));
  }

  private async processDispatch(job: any) {
    const { smsJobId } = job.data;
    this.logger.log(`Processing dispatch for SMS ${smsJobId}`);

    const gateway = await this.gatewaysService.getActiveGateway();
    if (!gateway) {
      throw new Error('No active gateway available');
    }

    const job_record = await this.prisma.smsJob.findUnique({ where: { id: smsJobId } });
    if (!job_record || job_record.status !== 'CLAIMED') {
      this.logger.warn(`SMS ${smsJobId} is not in CLAIMED status, skipping`);
      return;
    }

    await this.prisma.smsJob.update({
      where: { id: smsJobId },
      data: { status: 'SENDING' },
    });

    await this.prisma.smsAttempt.updateMany({
      where: { smsJobId, status: 'CLAIMED' },
      data: { status: 'SENDING' },
    });

    return { processed: true };
  }

  private async processRetry(job: any) {
    const { smsJobId } = job.data;
    this.logger.log(`Retrying SMS ${smsJobId}`);

    const smsJob = await this.prisma.smsJob.findUnique({ where: { id: smsJobId } });
    if (!smsJob || smsJob.status !== 'RETRYING') return;

    await this.prisma.smsJob.update({
      where: { id: smsJobId },
      data: { status: 'QUEUED' },
    });
  }
}
