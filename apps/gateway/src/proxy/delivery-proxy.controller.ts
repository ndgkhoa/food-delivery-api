import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

// The delivery service serves its routes UNDER `/api/v1/delivery` (its controller
// is `@Controller('delivery/orders')`), so we strip only `/api/v1` here and keep
// `/delivery` in the forwarded path (the forwarder re-prefixes with `/api/v1`).
const GATEWAY_DELIVERY_PREFIX = '/api/v1';

/**
 * Reverse-proxy edge for the delivery bounded context (HTTP reads only:
 * nearby-drivers + assignment). Every route under `/api/v1/delivery/*` requires
 * a valid token (global JwtAuthGuard) and is relayed to the delivery service with
 * the verified identity as trusted headers — the service scopes results to that
 * tenant. Live driver location is WebSocket and bypasses this proxy: clients
 * connect DIRECT to the delivery service (Nginx WS-upgrade is a later infra step).
 */
@Controller('delivery')
export class DeliveryProxyController {
  private readonly baseUrl: string;

  constructor(
    private readonly forwarder: HttpForwarder,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('DELIVERY_SERVICE_URL');
  }

  // Two routes so BOTH the base path and any subpath are relayed: path-to-regexp
  // v8's `*path` wildcard matches subpaths only, never the bare controller path.
  @All()
  proxyRoot(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    return this.relay(req, res);
  }

  @All('*path')
  proxy(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    return this.relay(req, res);
  }

  private relay(req: AuthenticatedRequest, res: Response): Promise<void> {
    return this.forwarder.forward(req, res, {
      gatewayPrefix: GATEWAY_DELIVERY_PREFIX,
      baseUrl: this.baseUrl,
      serviceName: 'delivery',
    });
  }
}
