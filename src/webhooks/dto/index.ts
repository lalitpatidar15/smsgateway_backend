import { IsString, IsArray, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWebhookEndpointDto {
  @ApiProperty({ example: 'https://api.invovault.com/webhooks/sms' })
  @IsString()
  url: string;

  @ApiPropertyOptional({ example: ['sms.queued', 'sms.sent', 'sms.delivered', 'sms.failed'] })
  @IsArray()
  @IsOptional()
  events?: string[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  gatewayDeviceId?: string;
}
