import { Controller, Post, Get, Patch, Delete, Param, Body, UseGuards, Req, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { GatewaysService } from './gateways.service';
import { GatewayAuthGuard } from './gateway-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RegisterGatewayDto, HeartbeatDto, RegisterSimDto } from './dto';

@ApiTags('Gateways')
@Controller('gateways')
export class GatewaysController {
  constructor(private gatewaysService: GatewaysService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new gateway device' })
  async register(@Body() dto: RegisterGatewayDto) {
    return this.gatewaysService.register(dto);
  }

  @Post('heartbeat')
  @UseGuards(GatewayAuthGuard)
  @ApiSecurity('gateway-token')
  @ApiOperation({ summary: 'Send gateway heartbeat' })
  async heartbeat(@Req() req: any, @Body() dto: HeartbeatDto, @Headers('x-forwarded-for') ip?: string) {
    return this.gatewaysService.heartbeat(req.gateway.id, dto, ip);
  }

  @Get('messages/pending')
  @UseGuards(GatewayAuthGuard)
  @ApiSecurity('gateway-token')
  @ApiOperation({ summary: 'Get pending messages for this gateway' })
  async getPendingMessages(@Req() req: any) {
    return { messages: [] };
  }

  @Post('messages/claim')
  @UseGuards(GatewayAuthGuard)
  @ApiSecurity('gateway-token')
  @ApiOperation({ summary: 'Atomically claim pending messages' })
  async claimMessages(@Req() req: any, @Body() body: { limit?: number }) {
    return { messages: [] };
  }

  @Post('messages/:id/status')
  @UseGuards(GatewayAuthGuard)
  @ApiSecurity('gateway-token')
  @ApiOperation({ summary: 'Update message status' })
  async updateMessageStatus(@Param('id') id: string, @Body() body: any) {
    return { success: true };
  }

  @Post('sims')
  @UseGuards(GatewayAuthGuard)
  @ApiSecurity('gateway-token')
  @ApiOperation({ summary: 'Register SIM card' })
  async registerSim(@Body() dto: RegisterSimDto) {
    return this.gatewaysService.registerSim(dto);
  }

  @Get('sims')
  @UseGuards(GatewayAuthGuard)
  @ApiSecurity('gateway-token')
  @ApiOperation({ summary: 'Get SIM cards for this gateway' })
  async getSims(@Req() req: any) {
    return this.gatewaysService.getSims(req.gateway.id);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all gateways (admin)' })
  async findAll() {
    return this.gatewaysService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get gateway details (admin)' })
  async findOne(@Param('id') id: string) {
    return this.gatewaysService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update gateway (admin)' })
  async update(@Param('id') id: string, @Body() data: any) {
    return this.gatewaysService.update(id, data);
  }

  @Post(':id/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable gateway (admin)' })
  async disable(@Param('id') id: string) {
    return this.gatewaysService.disable(id);
  }

  @Post(':id/enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable gateway (admin)' })
  async enable(@Param('id') id: string) {
    return this.gatewaysService.enable(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete gateway (admin)' })
  async remove(@Param('id') id: string) {
    return this.gatewaysService.remove(id);
  }
}
