import { Module } from '@nestjs/common';
import { GatewaysService } from './gateways.service';
import { GatewaysController } from './gateways.controller';
import { GatewayAuthGuard } from './gateway-auth.guard';

@Module({
  controllers: [GatewaysController],
  providers: [GatewaysService, GatewayAuthGuard],
  exports: [GatewaysService],
})
export class GatewaysModule {}
