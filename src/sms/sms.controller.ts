import { Controller, Post, Get, Body, Param, Query, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { SmsService } from './sms.service';
import { DeviceService } from '../device/device.service';

@Controller('sms')
export class SmsController {
  constructor(
    private smsService: SmsService,
    private deviceService: DeviceService,
  ) {}

  @Post('send')
  async send(@Body() body: { phone_number: string; message: string; device_id?: string }) {
    return this.smsService.send(body);
  }

  @Get('jobs/pending')
  async getPending(
    @Headers('authorization') auth: string,
    @Query('limit') limit?: string,
  ) {
    const token = auth?.replace('Bearer ', '');
    const device = await this.deviceService.authenticate(token);
    return this.smsService.getPending(device.deviceId, limit ? parseInt(limit) : 5);
  }

  @Post('jobs/:id/processing')
  @HttpCode(HttpStatus.OK)
  async markProcessing(
    @Param('id') id: string,
    @Headers('authorization') auth: string,
  ) {
    const token = auth?.replace('Bearer ', '');
    const device = await this.deviceService.authenticate(token);
    return this.smsService.markProcessing(id, device.deviceId);
  }

  @Post('jobs/:id/sent')
  @HttpCode(HttpStatus.OK)
  async markSent(@Param('id') id: string) {
    return this.smsService.markSent(id);
  }

  @Post('jobs/:id/failed')
  @HttpCode(HttpStatus.OK)
  async markFailed(
    @Param('id') id: string,
    @Body() body: { error: string },
  ) {
    return this.smsService.markFailed(id, body.error);
  }

  @Get('stats')
  async getStats() {
    return this.smsService.getStats();
  }
}
