import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

// The order service serves its routes UNDER `/api/v1/orders` (its controller is
// `@Controller('orders')`), unlike catalog/auth whose controllers omit the
// context segment. So we strip only `/api/v1` here and keep `/orders` in the
// forwarded path (the forwarder re-prefixes with `/api/v1`).
const GATEWAY_ORDER_PREFIX = '/api/v1';

/**
 * Reverse-proxy edge for the order bounded context. Every route under
 * `/api/v1/orders/*` requires a valid token (enforced by the global
 * JwtAuthGuard) and is relayed to the order service with the verified
 * identity attached as trusted headers; ownership of a given order is
 * enforced by the order service itself (owner or admin), not here.
 *
 * Placement is ASYNCHRONOUS: `POST /orders` returns a `PENDING` order while a
 * Kafka saga reserves stock + charges payment in the background; clients poll
 * `GET /orders/:id` for the terminal `CONFIRMED`/`CANCELLED` state. The proxy is
 * a transparent passthrough — this contract is documented in the order service's
 * own OpenAPI (served at its `/api/v1/reference`).
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

  // Two routes so BOTH the collection root (`POST /orders`) and any subpath
  // (`/orders/:id/cancel`) are relayed: path-to-regexp v8's `*path` wildcard
  // matches subpaths only, never the bare controller path.
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
      gatewayPrefix: GATEWAY_ORDER_PREFIX,
      baseUrl: this.baseUrl,
      serviceName: 'order',
    });
  }
}
