import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { GatewaysService } from '../gateways/gateways.service';

@Injectable()
export class SmsDispatcherService {
  private readonly logger = new Logger(SmsDispatcherService.name);

  constructor(
    private prisma: PrismaService,
    private gatewaysService: GatewaysService,
  ) {}

  async dispatchQueuedMessages() {
    const gateway = await this.gatewaysService.getActiveGateway();
    if (!gateway) {
      this.logger.warn('No active gateway available for dispatch');
      return;
    }

    const queuedJobs = await this.prisma.smsJob.findMany({
      where: {
        status: 'QUEUED',
        scheduledAt: { lte: new Date() },
      },
      take: 10,
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    for (const job of queuedJobs) {
      const defaultSim = gateway.sims[0];
      await this.prisma.smsJob.update({
        where: { id: job.id },
        data: {
          status: 'CLAIMED',
          gatewayDeviceId: gateway.id,
          gatewaySimId: defaultSim?.id,
          claimedAt: new Date(),
          claimExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
        },
      });

      await this.prisma.smsAttempt.create({
        data: {
          smsJobId: job.id,
          gatewayDeviceId: gateway.id,
          gatewaySimId: defaultSim?.id,
          attemptNumber: job.attemptCount + 1,
          status: 'CLAIMED',
        },
      });
    }

    return { dispatched: queuedJobs.length, gatewayId: gateway.id };
  }

  async recoverExpiredClaims() {
    const result = await this.prisma.$executeRaw`
      UPDATE sms_jobs
      SET
        status = CASE
          WHEN attempt_count < max_attempts THEN 'RETRYING'
          ELSE 'FAILED'
        END,
        gateway_device_id = NULL,
        claimed_at = NULL,
        claim_expires_at = NULL,
        attempt_count = attempt_count + 1
      WHERE status = 'CLAIMED'
      AND claim_expires_at < NOW()
    `;

    this.logger.log(`Recovered ${result} expired claims`);
    return { recovered: Number(result) };
  }

  async promoteScheduledMessages() {
    const result = await this.prisma.smsJob.updateMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: new Date() },
      },
      data: { status: 'QUEUED' },
    });

    this.logger.log(`Promoted ${result.count} scheduled messages to QUEUED`);
    return { promoted: result.count };
  }

  async retryFailedJobs() {
    const retryDelays = (process.env.SMS_RETRY_DELAYS_MS || '30000,120000,600000').split(',').map(Number);

    const failedJobs = await this.prisma.smsJob.findMany({
      where: { status: 'RETRYING' },
      take: 20,
    });

    for (const job of failedJobs) {
      if (job.attemptCount > retryDelays.length) {
        await this.prisma.smsJob.update({
          where: { id: job.id },
          data: { status: 'FAILED' },
        });
        continue;
      }
    }

    return { checked: failedJobs.length };
  }
}
