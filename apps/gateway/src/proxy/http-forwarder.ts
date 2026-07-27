import { CORRELATION_ID_HEADER } from '@food-delivery-api/shared-logging';
import { applyTrustedIdentityHeaders } from '@food-delivery-api/shared-tenancy';
import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

/** Prefix the gateway exposes; the remainder is forwarded onto catalog's own `/api/v1`. */
const GATEWAY_CATALOG_PREFIX = '/api/v1/catalog';
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);
/** Hop-by-hop / content-negotiation headers that must not be copied verbatim onto the client response. */
const SKIP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

/**
 * Thin HTTP forwarder (native fetch) that relays a verified request to the
 * catalog service. Chosen over http-proxy-middleware because it runs AFTER the
 * NestJS guard (so identity is already verified) and lets us build the outbound
 * header set from scratch — the client's `Authorization` and any spoofed
 * identity headers are never copied; only the gateway-derived identity is sent.
 */
@Injectable()
export class HttpForwarder {
  private readonly catalogBaseUrl: string;

  constructor(config: ConfigService) {
    this.catalogBaseUrl = config.getOrThrow<string>('CATALOG_SERVICE_URL').replace(/\/$/, '');
  }

  async forward(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.identity) {
      // Guard guarantees this; defensive check keeps the type non-optional below.
      throw new Error('forward() called without a verified identity');
    }

    const suffix = req.originalUrl.slice(
      req.originalUrl.indexOf(GATEWAY_CATALOG_PREFIX) + GATEWAY_CATALOG_PREFIX.length,
    );
    const targetUrl = `${this.catalogBaseUrl}/api/v1${suffix}`;

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const correlationId = req.headers[CORRELATION_ID_HEADER];
    if (typeof correlationId === 'string') {
      headers[CORRELATION_ID_HEADER] = correlationId;
    }
    // Only the verified identity is forwarded — nothing the client supplied.
    applyTrustedIdentityHeaders(headers, req.identity);

    const init: RequestInit = { method: req.method, headers };
    if (!BODYLESS_METHODS.has(req.method)) {
      init.body = JSON.stringify(req.body ?? {});
    }

    const upstream = await fetch(targetUrl, init);

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }
}
