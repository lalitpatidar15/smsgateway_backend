import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './config/prisma.module';
import { SmsController } from './sms/sms.controller';
import { SmsService } from './sms/sms.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
  ],
  controllers: [SmsController],
  providers: [SmsService],
})
export class AppModule {}