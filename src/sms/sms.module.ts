import { Module, forwardRef } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { SmsDispatcherService } from './sms-dispatcher.service';
import { GatewaysModule } from '../gateways/gateways.module';
import { RateLimitModule } from '../rate-limits/rate-limit.module';

@Module({
  imports: [
    forwardRef(() => GatewaysModule),
    RateLimitModule,
  ],
  controllers: [SmsController],
  providers: [SmsService, SmsDispatcherService],
  exports: [SmsService],
})
export class SmsModule {}
