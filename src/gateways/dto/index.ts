import { IsString, IsOptional, IsNumber, IsBoolean, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterGatewayDto {
  @ApiProperty({ example: 'e78f48b8-7dd8-4dc5' })
  @IsString()
  deviceId: string;

  @ApiProperty({ example: 'Office Gateway 01' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'Samsung' })
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'SM-A525F' })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional({ example: '14' })
  @IsString()
  @IsOptional()
  androidVersion?: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsString()
  @IsOptional()
  appVersion?: string;

  @ApiPropertyOptional({ example: 'android' })
  @IsString()
  @IsOptional()
  platform?: string;
}

export class HeartbeatDto {
  @ApiPropertyOptional({ example: 87 })
  @IsNumber()
  @IsOptional()
  battery?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  charging?: boolean;

  @ApiPropertyOptional({ example: 'WIFI' })
  @IsString()
  @IsOptional()
  network?: string;

  @ApiPropertyOptional({ example: -82 })
  @IsNumber()
  @IsOptional()
  signalStrength?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  simCount?: number;
}

export class RegisterSimDto {
  @ApiProperty()
  @IsString()
  gatewayDeviceId: string;

  @ApiProperty({ example: 0 })
  @IsNumber()
  slotIndex: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  subscriptionId?: string;

  @ApiPropertyOptional({ example: 'Airtel' })
  @IsString()
  @IsOptional()
  carrierName?: string;

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  phoneNumber: string;

  @ApiPropertyOptional({ example: 'IN' })
  @IsString()
  @IsOptional()
  countryCode?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
