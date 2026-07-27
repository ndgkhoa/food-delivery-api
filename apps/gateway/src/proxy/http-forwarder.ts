import { CORRELATION_ID_HEADER } from '@food-delivery-api/shared-logging';
import { applyTrustedIdentityHeaders } from '@food-delivery-api/shared-tenancy';
import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { Injectable } from '@nestjs/common';
import type { Response } from 'express';

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);
/** Hop-by-hop / content-negotiation headers that must not be copied verbatim onto the client response. */
const SKIP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding']);
/** Bound the upstream call so a slow/hung upstream can never hang the gateway (fail closed with 504). */
const FORWARD_TIMEOUT_MS = 10_000;

/** Where a proxy route relays to: the gateway-exposed prefix + the upstream base URL. */
export interface ForwardTarget {
  /** Prefix the gateway exposes (e.g. `/api/v1/catalog`); the remainder is forwarded onto the upstream's own `/api/v1`. */
  gatewayPrefix: string;
  /** Base URL of the upstream service (no trailing slash required — normalised here). */
  baseUrl: string;
}

/**
 * Thin HTTP forwarder (native fetch) that relays a verified request to a
 * downstream service. Chosen over http-proxy-middleware because it runs AFTER
 * the NestJS guard (so identity is already verified) and lets us build the
 * outbound header set from scratch — the client's `Authorization` and any
 * spoofed identity headers are never copied; only the gateway-derived identity
 * is sent. Stateless: each proxy controller passes its own `ForwardTarget`.
 */
@Injectable()
export class HttpForwarder {
  async forward(req: AuthenticatedRequest, res: Response, target: ForwardTarget): Promise<void> {
    if (!req.identity) {
      // Guard guarantees this; defensive check keeps the type non-optional below.
      throw new Error('forward() called without a verified identity');
    }

    const baseUrl = target.baseUrl.replace(/\/$/, '');
    const suffix = req.originalUrl.slice(
      req.originalUrl.indexOf(target.gatewayPrefix) + target.gatewayPrefix.length,
    );
    const targetUrl = `${baseUrl}/api/v1${suffix}`;

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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(targetUrl, { ...init, signal: controller.signal });
    } catch (err) {
      // Upstream unreachable or too slow → fail closed with a gateway error,
      // never a silent hang or a misleading 500 from the gateway itself.
      const timedOut = err instanceof Error && err.name === 'AbortError';
      const status = timedOut ? 504 : 502;
      res
        .status(status)
        .json({ statusCode: status, message: timedOut ? 'Upstream timed out' : 'Bad gateway' });
      return;
    } finally {
      clearTimeout(timer);
    }

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }
}
