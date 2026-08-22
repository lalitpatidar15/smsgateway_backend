import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { GatewaysService } from './gateways.service';

@Injectable()
export class GatewayAuthGuard implements CanActivate {
  constructor(private gatewaysService: GatewaysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Gateway token required');
    }

    const token = authHeader.substring(7);
    const gateway = await this.gatewaysService.authenticate(token);
    request.gateway = gateway;
    return true;
  }
}
