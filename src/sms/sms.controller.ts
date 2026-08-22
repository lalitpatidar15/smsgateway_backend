import { Controller, Post, Get, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { SmsService } from './sms.service';
import { SmsDispatcherService } from './sms-dispatcher.service';
import { CreateSmsDto, CreateBulkSmsDto, SmsQueryDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GatewayAuthGuard } from '../gateways/gateway-auth.guard';

@ApiTags('SMS')
@Controller('sms')
export class SmsController {
  constructor(
    private smsService: SmsService,
    private smsDispatcherService: SmsDispatcherService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new SMS job' })
  async create(@Body() dto: CreateSmsDto, @Req() req: any) {
    dto._apiKeyId = req.user?.apiKeyId;
    return this.smsService.create(dto);
  }

  @Post('bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create bulk SMS jobs' })
  async createBulk(@Body() dto: CreateBulkSmsDto, @Req() req: any) {
    dto._apiKeyId = req.user?.apiKeyId;
    return this.smsService.createBulk(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List SMS jobs' })
  async findAll(@Query() query: SmsQueryDto) {
    return this.smsService.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get SMS job details' })
  async findOne(@Param('id') id: string) {
    return this.smsService.findOne(id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel an SMS job' })
  async cancel(@Param('id') id: string) {
    return this.smsService.cancel(id);
  }

  @Post('dispatch')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually trigger dispatch (admin)' })
  async dispatch() {
    return this.smsDispatcherService.dispatchQueuedMessages();
  }

  @Post('recover-claims')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Recover expired claims (admin)' })
  async recoverClaims() {
    return this.smsDispatcherService.recoverExpiredClaims();
  }
}
