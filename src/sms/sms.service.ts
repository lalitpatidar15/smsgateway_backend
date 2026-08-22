import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { normalizePhoneNumber } from '../common/utils/phone.util';
import { calculateSmsSegments } from '../common/utils/sms.util';
import { CreateSmsDto, CreateBulkSmsDto, SmsQueryDto } from './dto';
import { SmsJobStatus, SmsPriority } from '@prisma/client';

@Injectable()
export class SmsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSmsDto) {
    const recipient = normalizePhoneNumber(dto.to);
    const { segmentCount, encoding } = calculateSmsSegments(dto.message);

    if (dto.idempotencyKey) {
      const existing = await this.prisma.smsJob.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        return { id: existing.id, status: existing.status, idempotent: true };
      }
    }

    const status: SmsJobStatus = dto.scheduledAt ? 'SCHEDULED' : 'QUEUED';
    const maxAttempts = parseInt(process.env.SMS_MAX_ATTEMPTS || '3');

    const job = await this.prisma.smsJob.create({
      data: {
        recipient,
        message: dto.message,
        status,
        priority: (dto.priority as SmsPriority) || SmsPriority.NORMAL,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        maxAttempts,
        segmentCount,
        encoding,
        metadata: dto.metadata as any,
        idempotencyKey: dto.idempotencyKey,
        externalId: dto.externalId,
        apiKeyId: dto._apiKeyId,
      },
    });

    return { id: job.id, status: job.status };
  }

  async createBulk(dto: CreateBulkSmsDto) {
    const maxBulk = parseInt(process.env.BULK_SMS_MAX_MESSAGES || '100');
    if (dto.messages.length > maxBulk) {
      throw new BadRequestException(`Maximum ${maxBulk} messages per bulk request`);
    }

    const results = await this.prisma.$transaction(
      dto.messages.map((msg) => {
        const recipient = normalizePhoneNumber(msg.to);
        const { segmentCount, encoding } = calculateSmsSegments(msg.message);
        const status: SmsJobStatus = msg.scheduledAt ? 'SCHEDULED' : 'QUEUED';
        const maxAttempts = parseInt(process.env.SMS_MAX_ATTEMPTS || '3');

        return this.prisma.smsJob.create({
          data: {
            recipient,
            message: msg.message,
            status,
            priority: (msg.priority as SmsPriority) || SmsPriority.NORMAL,
            scheduledAt: msg.scheduledAt ? new Date(msg.scheduledAt) : null,
            maxAttempts,
            segmentCount,
            encoding,
            idempotencyKey: msg.idempotencyKey,
            apiKeyId: dto._apiKeyId,
          },
          select: { id: true, status: true },
        });
      }),
    );

    return { messages: results, total: results.length };
  }

  async findOne(id: string) {
    const job = await this.prisma.smsJob.findUnique({
      where: { id },
      include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
    });
    if (!job) throw new NotFoundException('SMS job not found');
    return job;
  }

  async findAll(query: SmsQueryDto) {
    const { status, recipient, gatewayId, from, to, page = 1, limit = 50 } = query;
    const where: any = {};

    if (status) where.status = status;
    if (recipient) where.recipient = { contains: recipient };
    if (gatewayId) where.gatewayDeviceId = gatewayId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [jobs, total] = await Promise.all([
      this.prisma.smsJob.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.smsJob.count({ where }),
    ]);

    return {
      data: jobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async cancel(id: string) {
    const job = await this.prisma.smsJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('SMS job not found');

    if (!['QUEUED', 'SCHEDULED', 'RETRYING'].includes(job.status)) {
      throw new ConflictException(`Cannot cancel SMS in ${job.status} status`);
    }

    return this.prisma.smsJob.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  async claimMessages(gatewayId: string, limit: number = 5) {
    const claimExpiryMinutes = parseInt(process.env.CLAIM_EXPIRY_MINUTES || '2');
    const claimExpiresAt = new Date(Date.now() + claimExpiryMinutes * 60 * 1000);

    const jobs = await this.prisma.$queryRaw<any[]>`
      UPDATE sms_jobs
      SET
        status = 'CLAIMED',
        gateway_device_id = ${gatewayId},
        claimed_at = NOW(),
        claim_expires_at = ${claimExpiresAt}
      WHERE id IN (
        SELECT id FROM sms_jobs
        WHERE status = 'QUEUED'
        AND (scheduled_at IS NULL OR scheduled_at <= NOW())
        ORDER BY
          CASE priority
            WHEN 'URGENT' THEN 0
            WHEN 'HIGH' THEN 1
            WHEN 'NORMAL' THEN 2
            WHEN 'LOW' THEN 3
          END,
          created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, recipient, message, priority
    `;

    return { messages: jobs };
  }

  async updateStatus(id: string, status: string, errorCode?: string, errorMessage?: string) {
    const job = await this.prisma.smsJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('SMS job not found');

    const updateData: any = { status };

    switch (status) {
      case 'SENDING':
        break;
      case 'SENT':
        updateData.sentAt = new Date();
        break;
      case 'DELIVERED':
        updateData.deliveredAt = new Date();
        break;
      case 'FAILED':
        updateData.failedAt = new Date();
        updateData.lastErrorCode = errorCode;
        updateData.lastErrorMessage = errorMessage;
        break;
    }

    return this.prisma.smsJob.update({ where: { id }, data: updateData });
  }
}
