import { Controller, Post, Get, Body, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { DeviceService } from './device.service';

@Controller('device')
export class DeviceController {
  constructor(private deviceService: DeviceService) {}

  @Post('register')
  async register(@Body() body: { device_id: string; name?: string }) {
    return this.deviceService.register(body);
  }

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(
    @Headers('authorization') auth: string,
    @Body() body: { battery?: number; network?: string; sim_info?: string },
  ) {
    const token = auth?.replace('Bearer ', '');
    const device = await this.deviceService.authenticate(token);
    return this.deviceService.heartbeat(device.deviceId, {
      ...body,
      ip: null,
    });
  }

  @Get('list')
  async list() {
    return this.deviceService.findAll();
  }
}
