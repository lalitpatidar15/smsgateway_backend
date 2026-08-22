import { IsString, IsArray, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'InvoVault Production' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: ['sms:send', 'sms:read'] })
  @IsArray()
  @IsOptional()
  permissions?: string[];

  @ApiPropertyOptional({ example: 100 })
  @IsNumber()
  @IsOptional()
  rateLimitPerMinute?: number;

  @ApiPropertyOptional({ example: 500 })
  @IsNumber()
  @IsOptional()
  dailyLimit?: number;
}
