import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

const GATEWAY_AUTH_PREFIX = '/api/v1/auth';

/**
 * Reverse-proxy edge for the auth bounded context (tenant registry + user
 * provisioning). Its `@All('*path')` catch-all relays every remaining
 * `/api/v1/auth/*` route to the auth service with the verified identity attached
 * as trusted headers; a valid token is required (global JwtAuthGuard). The
 * session routes (`token`/`refresh`/`logout`) are handled by
 * KeycloakSessionController, which is registered ahead of this controller.
 * Admin RBAC (`@Roles('admin')`) is enforced at the auth service itself.
 */
@Controller('auth')
export class AuthProxyController {
  private readonly baseUrl: string;

  constructor(
    private readonly forwarder: HttpForwarder,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('AUTH_SERVICE_URL');
  }

  @All('*path')
  proxy(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    return this.forwarder.forward(req, res, {
      gatewayPrefix: GATEWAY_AUTH_PREFIX,
      baseUrl: this.baseUrl,
    });
  }
}
