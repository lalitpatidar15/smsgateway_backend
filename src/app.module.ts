import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './config/prisma.module';
import { SmsController } from './sms/sms.controller';
import { SmsService } from './sms/sms.service';
import { DeviceController } from './device/device.controller';
import { DeviceService } from './device/device.service';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
  ],
  controllers: [SmsController, DeviceController, HealthController],
  providers: [SmsService, DeviceService],
})
export class AppModule {}
