import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { SmsModule } from '../sms/sms.module';
import { GatewaysModule } from '../gateways/gateways.module';
import { DeliveryModule } from '../delivery/delivery.module';

@Module({
  imports: [SmsModule, GatewaysModule, DeliveryModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
