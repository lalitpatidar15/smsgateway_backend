import { Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { SmsService } from '../sms/sms.service';
import { GatewaysService } from '../gateways/gateways.service';
import { DeliveryService } from '../delivery/delivery.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private smsService: SmsService,
    private gatewaysService: GatewaysService,
    private deliveryService: DeliveryService,
  ) {}

  async getDashboard() {
    const [gateways, smsToday, smsStatuses] = await Promise.all([
      this.prisma.gatewayDevice.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.prisma.smsJob.count({
        where: {
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      this.prisma.smsJob.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
        _count: true,
      }),
    ]);

    const gatewayStats = { total: 0, online: 0, offline: 0 };
    for (const g of gateways) {
      gatewayStats.total += g._count;
      if (g.status === 'ACTIVE') gatewayStats.online += g._count;
      if (g.status === 'OFFLINE') gatewayStats.offline += g._count;
    }

    const smsStats: any = { today: smsToday, queued: 0, sent: 0, delivered: 0, failed: 0 };
    for (const s of smsStatuses) {
      smsStats[s.status.toLowerCase()] = s._count;
    }

    return { gateways: gatewayStats, sms: smsStats };
  }

  async retrySms(id: string) {
    const job = await this.smsService.findOne(id);
    if (job.status !== 'FAILED') {
      throw new Error('Only failed SMS can be retried');
    }

    return this.smsService.cancel(id).then(() =>
      this.prisma.smsJob.update({
        where: { id },
        data: { status: 'QUEUED', attemptCount: 0 },
      }),
    );
  }

  async getAuditLogs(page: number = 1, limit: number = 50) {
    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count(),
    ]);

    return {
      data: logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
