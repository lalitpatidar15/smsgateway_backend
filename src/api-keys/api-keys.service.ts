import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { generateApiKey } from '../common/utils';
import { CreateApiKeyDto } from './dto';

@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateApiKeyDto) {
    const { key, hash, short } = generateApiKey(process.env.API_KEY_PREFIX || 'sg_live_');

    const apiKey = await this.prisma.apiKey.create({
      data: {
        name: dto.name,
        keyHash: hash,
        keyPrefix: short,
        permissions: dto.permissions || ['sms:send', 'sms:read'],
        rateLimitPerMinute: dto.rateLimitPerMinute || 100,
        dailyLimit: dto.dailyLimit || 500,
      },
    });

    return {
      id: apiKey.id,
      key,
      prefix: short,
      name: apiKey.name,
      permissions: apiKey.permissions,
      status: apiKey.status,
    };
  }

  async findAll() {
    return this.prisma.apiKey.findMany({
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        status: true,
        permissions: true,
        rateLimitPerMinute: true,
        dailyLimit: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const key = await this.prisma.apiKey.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        status: true,
        permissions: true,
        rateLimitPerMinute: true,
        dailyLimit: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
    });
    if (!key) throw new NotFoundException('API key not found');
    return key;
  }

  async revoke(id: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key not found');

    return this.prisma.apiKey.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
  }

  async delete(id: string) {
    await this.findOne(id);
    return this.prisma.apiKey.delete({ where: { id } });
  }
}
