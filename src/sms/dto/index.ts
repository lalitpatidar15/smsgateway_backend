import { IsString, IsOptional, IsEnum, IsArray, ValidateNested, IsDateString, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSmsDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  to: string;

  @ApiProperty({ example: 'Your laptop warranty expires in 7 days.' })
  @IsString()
  message: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  scheduledAt?: string;

  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] })
  @IsEnum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  @IsOptional()
  priority?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  idempotencyKey?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  externalId?: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  _apiKeyId?: string;
}

export class BulkSmsMessageDto {
  @ApiProperty({ example: '+919800000001' })
  @IsString()
  to: string;

  @ApiProperty({ example: 'Reminder A' })
  @IsString()
  message: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  scheduledAt?: string;

  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] })
  @IsEnum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  @IsOptional()
  priority?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}

export class CreateBulkSmsDto {
  @ApiProperty({ type: [BulkSmsMessageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkSmsMessageDto)
  messages: BulkSmsMessageDto[];

  _apiKeyId?: string;
}

export class SmsQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  recipient?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  gatewayId?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  limit?: number;
}
