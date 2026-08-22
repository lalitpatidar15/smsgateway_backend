import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { generateGatewayToken, hashToken } from '../common/utils';
import { RegisterGatewayDto, HeartbeatDto, RegisterSimDto } from './dto';

@Injectable()
export class GatewaysService {
  constructor(private prisma: PrismaService) {}

  async register(dto: RegisterGatewayDto) {
    const { token, hash } = generateGatewayToken(process.env.GATEWAY_TOKEN_PREFIX || 'gw_');

    const gateway = await this.prisma.gatewayDevice.create({
      data: {
        name: dto.name,
        deviceId: dto.deviceId,
        phoneNumber: dto.phoneNumber,
        tokenHash: hash,
        platform: dto.platform || 'android',
        appVersion: dto.appVersion,
        manufacturer: dto.manufacturer,
        model: dto.model,
        androidVersion: dto.androidVersion,
        status: 'PENDING',
      },
    });

    return {
      id: gateway.id,
      token,
      name: gateway.name,
      status: gateway.status,
    };
  }

  async authenticate(token: string) {
    const tokenHash = hashToken(token);
    const gateway = await this.prisma.gatewayDevice.findUnique({
      where: { tokenHash },
    });
    if (!gateway) throw new UnauthorizedException('Invalid gateway token');
    if (gateway.status === 'DISABLED' || gateway.status === 'BLOCKED') {
      throw new UnauthorizedException('Gateway is disabled');
    }
    return gateway;
  }

  async heartbeat(gatewayId: string, dto: HeartbeatDto, ip?: string) {
    const gateway = await this.prisma.gatewayDevice.update({
      where: { id: gatewayId },
      data: {
        lastSeenAt: new Date(),
        lastIp: ip,
        status: 'ACTIVE',
        battery: dto.battery,
        charging: dto.charging,
        network: dto.network,
        signalStrength: dto.signalStrength,
        simCount: dto.simCount,
      },
    });
    return { status: gateway.status };
  }

  async findAll() {
    return this.prisma.gatewayDevice.findMany({
      include: { sims: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const gateway = await this.prisma.gatewayDevice.findUnique({
      where: { id },
      include: { sims: true },
    });
    if (!gateway) throw new NotFoundException('Gateway not found');
    return gateway;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.gatewayDevice.update({ where: { id }, data });
  }

  async disable(id: string) {
    return this.update(id, { status: 'DISABLED' });
  }

  async enable(id: string) {
    return this.update(id, { status: 'ACTIVE' });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.gatewayDevice.delete({ where: { id } });
  }

  async registerSim(dto: RegisterSimDto) {
    return this.prisma.gatewaySim.create({
      data: {
        gatewayDeviceId: dto.gatewayDeviceId,
        slotIndex: dto.slotIndex,
        subscriptionId: dto.subscriptionId,
        carrierName: dto.carrierName,
        phoneNumber: dto.phoneNumber,
        countryCode: dto.countryCode,
        isActive: dto.isActive ?? true,
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  async getSims(gatewayId: string) {
    return this.prisma.gatewaySim.findMany({
      where: { gatewayDeviceId: gatewayId },
      orderBy: { slotIndex: 'asc' },
    });
  }

  async getActiveGateway() {
    const gateway = await this.prisma.gatewayDevice.findFirst({
      where: {
        status: 'ACTIVE',
        lastSeenAt: {
          gte: new Date(Date.now() - (parseInt(process.env.HEARTBEAT_ONLINE_THRESHOLD_MS || '60000'))),
        },
      },
      include: { sims: { where: { isActive: true, isDefault: true } } },
    });
    return gateway;
  }

  async updateOnlineStatuses() {
    const onlineThreshold = parseInt(process.env.HEARTBEAT_ONLINE_THRESHOLD_MS || '60000');
    const degradedThreshold = parseInt(process.env.HEARTBEAT_DEGRADED_THRESHOLD_MS || '300000');
    const now = new Date();

    await this.prisma.$executeRaw`
      UPDATE gateway_devices
      SET status = 'OFFLINE'
      WHERE status IN ('ACTIVE', 'DEGRADED')
      AND last_seen_at < ${new Date(now.getTime() - degradedThreshold)}
    `;

    await this.prisma.$executeRaw`
      UPDATE gateway_devices
      SET status = 'DEGRADED'
      WHERE status = 'ACTIVE'
      AND last_seen_at < ${new Date(now.getTime() - onlineThreshold)}
      AND last_seen_at >= ${new Date(now.getTime() - degradedThreshold)}
    `;
  }
}
