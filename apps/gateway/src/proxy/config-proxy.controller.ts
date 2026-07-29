import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

const GATEWAY_CONFIG_PREFIX = '/api/v1';

/**
 * Reverse-proxy edge for the config bounded context (business tunables +
 * feature flags). Every route under `/api/v1/config/*` requires a valid token
 * (global JwtAuthGuard) and is relayed to the config service with the
 * verified identity as trusted headers — the service itself enforces
 * admin/platform-admin on writes and tenant scoping on reads.
 */
@Controller('config')
export class ConfigProxyController {
  private readonly baseUrl: string;

  constructor(
    private readonly forwarder: HttpForwarder,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('CONFIG_SERVICE_URL');
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
      gatewayPrefix: GATEWAY_CONFIG_PREFIX,
      baseUrl: this.baseUrl,
      serviceName: 'config',
    });
  }
}
