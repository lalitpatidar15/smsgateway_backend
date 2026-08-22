import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(private prisma: PrismaService) {}

  async recordAttempt(data: {
    smsJobId: string;
    gatewayDeviceId: string;
    gatewaySimId?: string;
    attemptNumber: number;
    status: string;
    errorCode?: string;
    errorMessage?: string;
  }) {
    return this.prisma.smsAttempt.create({
      data: {
        smsJobId: data.smsJobId,
        gatewayDeviceId: data.gatewayDeviceId,
        gatewaySimId: data.gatewaySimId,
        attemptNumber: data.attemptNumber,
        status: data.status,
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
      },
    });
  }

  async updateAttemptStatus(attemptId: string, status: string) {
    const updateData: any = { status };
    if (status === 'SENT') updateData.sentAt = new Date();
    if (status === 'DELIVERED' || status === 'FAILED') updateData.completedAt = new Date();

    return this.prisma.smsAttempt.update({
      where: { id: attemptId },
      data: updateData,
    });
  }

  async getAttempts(smsJobId: string) {
    return this.prisma.smsAttempt.findMany({
      where: { smsJobId },
      orderBy: { attemptNumber: 'asc' },
    });
  }

  async getDeliveryStats(from?: Date, to?: Date) {
    const where: any = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    const [total, sent, delivered, failed] = await Promise.all([
      this.prisma.smsJob.count({ where }),
      this.prisma.smsJob.count({ where: { ...where, status: 'SENT' } }),
      this.prisma.smsJob.count({ where: { ...where, status: 'DELIVERED' } }),
      this.prisma.smsJob.count({ where: { ...where, status: 'FAILED' } }),
    ]);

    return { total, sent, delivered, failed, deliveryRate: total > 0 ? (delivered / total * 100).toFixed(2) : '0' };
  }
}
