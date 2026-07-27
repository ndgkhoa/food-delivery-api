import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { JwtAuthGuard } from '@gateway/guards/jwt-auth.guard';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { All, Controller, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

const GATEWAY_AUTH_PREFIX = '/api/v1/auth';

/**
 * Reverse-proxy edge for the auth bounded context (tenant registry + user
 * provisioning). Every route under `/api/v1/auth/*` requires a valid token
 * (JwtAuthGuard) and is relayed to the auth service with the verified identity
 * attached as trusted headers. Admin RBAC (`@Roles('admin')`) is enforced at
 * the auth service itself — the gateway only proves the caller is authenticated.
 */
@Controller('auth')
@UseGuards(JwtAuthGuard)
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
