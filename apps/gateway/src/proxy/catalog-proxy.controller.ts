import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { JwtAuthGuard } from '@gateway/guards/jwt-auth.guard';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { All, Controller, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Reverse-proxy edge for the catalog bounded context. Every route under
 * `/api/v1/catalog/*` requires a valid token (JwtAuthGuard) and is relayed to
 * the catalog service with the verified identity attached as trusted headers.
 */
@Controller('catalog')
@UseGuards(JwtAuthGuard)
export class CatalogProxyController {
  constructor(private readonly forwarder: HttpForwarder) {}

  @All('*path')
  proxy(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    return this.forwarder.forward(req, res);
  }
}
