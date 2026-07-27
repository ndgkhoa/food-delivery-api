import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

const GATEWAY_ORDER_PREFIX = '/api/v1/orders';

/**
 * Reverse-proxy edge for the order bounded context. Every route under
 * `/api/v1/orders/*` requires a valid token (enforced by the global
 * JwtAuthGuard) and is relayed to the order service with the verified
 * identity attached as trusted headers; ownership of a given order is
 * enforced by the order service itself (owner or admin), not here.
 */
@Controller('orders')
export class OrderProxyController {
  private readonly baseUrl: string;

  constructor(
    private readonly forwarder: HttpForwarder,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('ORDER_SERVICE_URL');
  }

  @All('*path')
  proxy(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    return this.forwarder.forward(req, res, {
      gatewayPrefix: GATEWAY_ORDER_PREFIX,
      baseUrl: this.baseUrl,
    });
  }
}
