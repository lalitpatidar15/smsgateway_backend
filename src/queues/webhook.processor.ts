import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from './queue.service';
import { WebhookService } from '../webhooks/webhook.service';

@Injectable()
export class WebhookProcessor implements OnModuleInit {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private queueService: QueueService,
    private webhookService: WebhookService,
  ) {}

  onModuleInit() {
    this.queueService.registerWorker('webhooks', this.processWebhook.bind(this));
  }

  private async processWebhook(job: any) {
    const { deliveryId } = job.data;
    this.logger.log(`Processing webhook delivery ${deliveryId}`);
    await this.webhookService.deliverWebhook(deliveryId);
    return { delivered: true };
  }
}
