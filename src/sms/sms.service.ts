import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class SmsService {
  constructor(private prisma: PrismaService) {}

  async send(data: { phone_number: string; message: string; device_id?: string }) {
    const job = await this.prisma.smsJob.create({
      data: {
        phoneNumber: data.phone_number,
        message: data.message,
        deviceId: data.device_id,
        status: 'pending',
      },
    });

    return {
      id: job.id,
      phone_number: job.phoneNumber,
      message: job.message,
      status: job.status,
      created_at: job.createdAt,
    };
  }

  async getPending(deviceId: string, limit: number = 5) {
    const jobs = await this.prisma.smsJob.findMany({
      where: {
        status: 'pending',
        OR: [
          { deviceId: null },
          { deviceId },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return jobs.map(job => ({
      id: job.id,
      phone_number: job.phoneNumber,
      message: job.message,
    }));
  }

  async markProcessing(jobId: string, deviceId: string) {
    const job = await this.prisma.smsJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.status !== 'pending') {
      throw new ConflictException(`Job is already ${job.status}`);
    }

    return this.prisma.smsJob.update({
      where: { id: jobId },
      data: {
        status: 'processing',
        deviceId,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
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
        status: 'sent',
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

    const maxAttempts = 3;
    const newStatus = job.attemptCount >= maxAttempts ? 'failed' : 'pending';

    return this.prisma.smsJob.update({
      where: { id: jobId },
      data: {
        status: newStatus,
        errorMessage: error,
        failedAt: newStatus === 'failed' ? new Date() : null,
        nextAttemptAt: newStatus === 'pending'
          ? new Date(Date.now() + 30000 * Math.pow(2, job.attemptCount))
          : null,
      },
    });
  }

  async getStats() {
    const [total, pending, processing, sent, failed] = await Promise.all([
      this.prisma.smsJob.count(),
      this.prisma.smsJob.count({ where: { status: 'pending' } }),
      this.prisma.smsJob.count({ where: { status: 'processing' } }),
      this.prisma.smsJob.count({ where: { status: 'sent' } }),
      this.prisma.smsJob.count({ where: { status: 'failed' } }),
    ]);

    return { total, pending, processing, sent, failed };
  }
}
