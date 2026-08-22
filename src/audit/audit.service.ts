import { Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(data: {
    actorType: string;
    actorId?: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    ip?: string;
    metadata?: any;
  }) {
    return this.prisma.auditLog.create({
      data: {
        actorType: data.actorType,
        actorId: data.actorId,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        ip: data.ip,
        metadata: data.metadata,
      },
    });
  }
}
