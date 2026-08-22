import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { generateSignature } from '../common/utils/crypto.util';
import { CreateWebhookEndpointDto } from './dto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private prisma: PrismaService) {}

  async createEndpoint(dto: CreateWebhookEndpointDto) {
    const secret = require('crypto').randomBytes(32).toString('hex');
    return this.prisma.webhookEndpoint.create({
      data: {
        url: dto.url,
        secret,
        events: dto.events || ['sms.queued', 'sms.sent', 'sms.delivered', 'sms.failed'],
        gatewayDeviceId: dto.gatewayDeviceId,
      },
    });
  }

  async getEndpoints() {
    return this.prisma.webhookEndpoint.findMany({ where: { isActive: true } });
  }

  async sendEvent(event: string, smsJob: any) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { isActive: true, events: { has: event } },
    });

    for (const endpoint of endpoints) {
      const payload = {
        event,
        data: {
          id: smsJob.id,
          to: smsJob.recipient,
          status: smsJob.status,
          createdAt: smsJob.createdAt,
          sentAt: smsJob.sentAt,
          deliveredAt: smsJob.deliveredAt,
        },
      };

      const payloadStr = JSON.stringify(payload);
      const signature = generateSignature(payloadStr, endpoint.secret);

      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          webhookEndpointId: endpoint.id,
          smsJobId: smsJob.id,
          event,
          payload: payload as any,
          maxAttempts: parseInt(process.env.WEBHOOK_MAX_ATTEMPTS || '5'),
        },
      });

      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-SmsGateway-Signature': `sha256=${signature}`,
            'X-SmsGateway-Event': event,
          },
          body: payloadStr,
        });

        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: response.ok ? 'SUCCESS' : 'FAILED',
            statusCode: response.status,
            attemptCount: 1,
          },
        });
      } catch (error) {
        this.logger.error(`Webhook delivery failed: ${error.message}`);
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'FAILED',
            attemptCount: 1,
            nextRetryAt: new Date(Date.now() + 60000),
          },
        });
      }
    }
  }

  async deliverWebhook(deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhookEndpoint: true },
    });

    if (!delivery || delivery.status === 'SUCCESS') return;

    const signature = generateSignature(
      JSON.stringify(delivery.payload),
      delivery.webhookEndpoint.secret,
    );

    try {
      const response = await fetch(delivery.webhookEndpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SmsGateway-Signature': `sha256=${signature}`,
          'X-SmsGateway-Event': delivery.event,
        },
        body: JSON.stringify(delivery.payload),
      });

      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: response.ok ? 'SUCCESS' : 'FAILED',
          statusCode: response.status,
          attemptCount: delivery.attemptCount + 1,
        },
      });
    } catch (error) {
      const retryDelays = (process.env.WEBHOOK_RETRY_DELAYS_MS || '60000,300000,1800000,7200000').split(',').map(Number);
      const nextRetry = retryDelays[delivery.attemptCount] || retryDelays[retryDelays.length - 1];

      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'FAILED',
          attemptCount: delivery.attemptCount + 1,
          nextRetryAt: delivery.attemptCount + 1 < delivery.maxAttempts
            ? new Date(Date.now() + nextRetry)
            : null,
        },
      });
    }
  }
}
