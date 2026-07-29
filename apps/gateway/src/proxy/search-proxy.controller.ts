import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

// The search service serves its routes UNDER `/api/v1/search` (its controller is
// `@Controller('search/restaurants')`), like order keeps its `/orders` segment.
// So we strip only `/api/v1` here and keep `/search` in the forwarded path (the
// forwarder re-prefixes with `/api/v1`).
const GATEWAY_SEARCH_PREFIX = '/api/v1';

/**
 * Reverse-proxy edge for the search bounded context. Every route under
 * `/api/v1/search/*` requires a valid token (enforced by the global
 * JwtAuthGuard) and is relayed to the search service with the verified identity
 * attached as trusted headers — the search service scopes results to that
 * tenant. Read-only surface (full-text search + autocomplete); no writes.
 */
@Controller('search')
export class SearchProxyController {
  private readonly baseUrl: string;

  constructor(
    private readonly forwarder: HttpForwarder,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('SEARCH_SERVICE_URL');
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
      gatewayPrefix: GATEWAY_SEARCH_PREFIX,
      baseUrl: this.baseUrl,
      serviceName: 'search',
    });
  }
}
