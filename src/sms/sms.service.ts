import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class SmsService {
  constructor(private prisma: PrismaService) {}

  async send(data: { phone_number: string; message: string }) {
    const job = await this.prisma.smsJob.create({
      data: {
        recipient: data.phone_number,
        message: data.message,
        status: 'QUEUED',
      },
    });

    return {
      id: job.id,
      recipient: job.recipient,
      message: job.message,
      status: job.status,
      createdAt: job.createdAt,
    };
  }

  async getPending(limit: number = 5) {
    const jobs = await this.prisma.smsJob.findMany({
      where: {
        status: 'QUEUED',
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return jobs.map(job => ({
      id: job.id,
      recipient: job.recipient,
      message: job.message,
    }));
  }

  async markProcessing(jobId: string) {
    const job = await this.prisma.smsJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.status !== 'QUEUED') {
      throw new ConflictException(`Job is already ${job.status}`);
    }

    return this.prisma.smsJob.update({
      where: { id: jobId },
      data: {
        status: 'RETRYING',
        attemptCount: { increment: 1 },
              },
    });
  }

  async markSent(jobId: string) {
    const job = await this.prisma.smsJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return this.prisma.smsJob.update({
      where: { id: jobId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
      },
    });
  }

  async markFailed(jobId: string, error: string) {
    const job = await this.prisma.smsJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return this.prisma.smsJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        lastErrorCode: error,
        lastErrorMessage: error,
      },
    });
  }

  async getStats() {
    const [total, queued, sent, delivered, failed] = await Promise.all([
      this.prisma.smsJob.count({ where: {} }),
      this.prisma.smsJob.count({ where: { status: 'QUEUED' } }),
      this.prisma.smsJob.count({ where: { status: 'SENT' } }),
      this.prisma.smsJob.count({ where: { status: 'DELIVERED' } }),
      this.prisma.smsJob.count({ where: { status: 'FAILED' } }),
    ]);

    return {
      total,
      queued,
      sent,
      delivered,
      failed,
      deliveryRate: total > 0 ? (delivered / total * 100).toFixed(2) : '0',
    };
  }
}
