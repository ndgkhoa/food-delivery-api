import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

const GATEWAY_CATALOG_PREFIX = '/api/v1/catalog';

/**
 * Reverse-proxy edge for the catalog bounded context. Every route under
 * `/api/v1/catalog/*` requires a valid token (enforced by the global
 * JwtAuthGuard) and is relayed to the catalog service with the verified
 * identity attached as trusted headers.
 */
@Controller('catalog')
export class CatalogProxyController {
  private readonly baseUrl: string;

  constructor(
    private readonly forwarder: HttpForwarder,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('CATALOG_SERVICE_URL');
  }

  @All('*path')
  proxy(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    return this.forwarder.forward(req, res, {
      gatewayPrefix: GATEWAY_CATALOG_PREFIX,
      baseUrl: this.baseUrl,
    });
  }
}
