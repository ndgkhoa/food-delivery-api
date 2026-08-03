import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

// The review service serves its routes UNDER `/api/v1/reviews` (its controller
// is `@Controller('reviews')`), like order — strip only `/api/v1` and keep
// `/reviews` in the forwarded path (the forwarder re-prefixes with `/api/v1`).
const GATEWAY_REVIEW_PREFIX = '/api/v1';

/**
 * Reverse-proxy edge for the review bounded context. Every route under
 * `/api/v1/reviews/*` requires a valid token (enforced by the global
 * JwtAuthGuard) and is relayed to the review service with the verified
 * identity attached as trusted headers; ownership of a given order's
 * eligibility is enforced by the review service itself, not here.
 */
@Controller('reviews')
export class ReviewProxyController {
  private readonly baseUrl: string;

  constructor(
    private readonly forwarder: HttpForwarder,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('REVIEW_SERVICE_URL');
  }

  // Two routes so BOTH the collection root (`POST /reviews`) and any subpath
  // are relayed: path-to-regexp v8's `*path` wildcard matches subpaths only,
  // never the bare controller path.
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
      gatewayPrefix: GATEWAY_REVIEW_PREFIX,
      baseUrl: this.baseUrl,
      serviceName: 'review',
    });
  }
}
