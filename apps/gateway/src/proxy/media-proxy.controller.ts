import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

// The media service serves its routes UNDER `/api/v1/media` (its controller is
// `@Controller('media')`), so we strip only `/api/v1` here and keep `/media` in
// the forwarded path (the forwarder re-prefixes with `/api/v1`).
const GATEWAY_MEDIA_PREFIX = '/api/v1';

/**
 * Reverse-proxy edge for the media bounded context. Every route under
 * `/api/v1/media/*` requires a valid token (global JwtAuthGuard) and is relayed
 * to the media service with the verified identity attached as trusted headers —
 * the media service scopes objects to that tenant. Only small JSON control
 * requests pass through here (create-upload, complete, get); the actual image
 * bytes never traverse the gateway — clients transfer them DIRECTLY to MinIO via
 * the presigned URLs the media service returns.
 */
@Controller('media')
export class MediaProxyController {
  private readonly baseUrl: string;

  constructor(
    private readonly forwarder: HttpForwarder,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('MEDIA_SERVICE_URL');
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
      gatewayPrefix: GATEWAY_MEDIA_PREFIX,
      baseUrl: this.baseUrl,
    });
  }
}
