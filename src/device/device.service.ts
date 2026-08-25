import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class DeviceService {
  constructor(private prisma: PrismaService) {}

  async register(data: { device_id: string; name?: string }) {
    const existing = await this.prisma.device.findUnique({
      where: { deviceId: data.device_id },
    });

    if (existing) {
      return {
        device_id: existing.deviceId,
        device_token: existing.deviceToken,
        status: 'already_registered',
      };
    }

    const deviceToken = `gw_${crypto.randomBytes(32).toString('hex')}`;

    const device = await this.prisma.device.create({
      data: {
        deviceId: data.device_id,
        deviceToken,
        name: data.name,
      },
    });

    return {
      device_id: device.deviceId,
      device_token: device.deviceToken,
      status: 'registered',
    };
  }

  async authenticate(token: string) {
    const device = await this.prisma.device.findFirst({
      where: { deviceToken: token, status: 'active' },
    });

    if (!device) {
      throw new UnauthorizedException('Invalid device token');
    }

    return device;
  }

  async heartbeat(deviceId: string, data: {
    battery?: number;
    network?: string;
    sim_info?: string;
    ip?: string;
  }) {
    return this.prisma.device.update({
      where: { deviceId },
      data: {
        lastSeenAt: new Date(),
        lastIp: data.ip,
        battery: data.battery,
        network: data.network,
        simInfo: data.sim_info,
      },
    });
  }

  async findAll() {
    return this.prisma.device.findMany({
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
