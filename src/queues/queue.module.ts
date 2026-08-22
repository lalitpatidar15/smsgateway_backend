import { Module, forwardRef } from '@nestjs/common';
import { QueueService } from './queue.service';
import { SmsProcessor } from './sms.processor';
import { ScheduledProcessor } from './scheduled.processor';
import { GatewayHealthProcessor } from './gateway-health.processor';
import { WebhookProcessor } from './webhook.processor';
import { GatewaysModule } from '../gateways/gateways.module';
import { WebhookModule } from '../webhooks/webhook.module';

@Module({
  imports: [
    forwardRef(() => GatewaysModule),
    forwardRef(() => WebhookModule),
  ],
  providers: [
    QueueService,
    SmsProcessor,
    ScheduledProcessor,
    GatewayHealthProcessor,
    WebhookProcessor,
  ],
  exports: [QueueService],
})
export class QueueModule {}
