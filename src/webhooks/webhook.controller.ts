import { Controller, Get, Post, Body, Delete, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import { CreateWebhookEndpointDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Webhooks')
@Controller('webhooks')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WebhookController {
  constructor(private webhookService: WebhookService) {}

  @Post('endpoints')
  @ApiOperation({ summary: 'Create webhook endpoint' })
  async createEndpoint(@Body() dto: CreateWebhookEndpointDto) {
    return this.webhookService.createEndpoint(dto);
  }

  @Get('endpoints')
  @ApiOperation({ summary: 'List webhook endpoints' })
  async getEndpoints() {
    return this.webhookService.getEndpoints();
  }
}
