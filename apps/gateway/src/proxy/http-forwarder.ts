import { CORRELATION_ID_HEADER } from '@food-delivery-api/shared-logging';
import { applyTrustedIdentityHeaders } from '@food-delivery-api/shared-tenancy';
import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { CircuitBreakerRegistry } from '@gateway/proxy/circuit-breaker.registry';
import { Injectable } from '@nestjs/common';
import type { Response } from 'express';

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);
/** Hop-by-hop / content-negotiation headers that must not be copied verbatim onto the client response. */
const SKIP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding']);
/** Bound the upstream call so a slow/hung upstream can never hang the gateway (fail closed with 504). */
const FORWARD_TIMEOUT_MS = 10_000;
/** Safe client headers relayed as-is to the upstream (lowercased — Express normalises header names). */
const FORWARDED_CLIENT_HEADERS = ['idempotency-key'];
/** opossum's error code when a fire() is rejected fast because the breaker is open. */
const OPEN_BREAKER_ERROR_CODE = 'EOPENBREAKER';

/** Where a proxy route relays to: the gateway-exposed prefix + the upstream base URL. */
export interface ForwardTarget {
  /** Prefix the gateway exposes (e.g. `/api/v1/catalog`); the remainder is forwarded onto the upstream's own `/api/v1`. */
  gatewayPrefix: string;
  /** Base URL of the upstream service (no trailing slash required — normalised here). */
  baseUrl: string;
  /** Downstream name the per-service circuit breaker is keyed by (e.g. 'catalog'). */
  serviceName: string;
}

/** A fully-materialised upstream response — headers AND body read before the client sees anything. */
interface UpstreamResult {
  status: number;
  headers: Headers;
  body: Buffer;
}

/**
 * Thin HTTP forwarder (native fetch) that relays a verified request to a
 * downstream service. Chosen over http-proxy-middleware because it runs AFTER
 * the NestJS guard (so identity is already verified) and lets us build the
 * outbound header set from scratch — the client's `Authorization` and any
 * spoofed identity headers are never copied; only the gateway-derived identity
 * is sent. Stateless: each proxy controller passes its own `ForwardTarget`.
 *
 * The outbound fetch runs through the target service's circuit breaker: a
 * connect failure or timeout counts as a breaker failure, while any resolved
 * upstream response (including 5xx) passes straight through and is never
 * recorded as one — the breaker guards "downstream unreachable", not
 * "downstream app bug".
 */
@Injectable()
export class HttpForwarder {
  constructor(private readonly breakers: CircuitBreakerRegistry) {}

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
    // Forward a small allowlist of safe client headers the downstream needs
    // (e.g. Idempotency-Key on create-order). NOT the client's Authorization or
    // any identity header — those are rebuilt from the verified identity below.
    for (const name of FORWARDED_CLIENT_HEADERS) {
      const value = req.headers[name];
      if (typeof value === 'string') {
        headers[name] = value;
      }
    }
    // Only the verified identity is forwarded — nothing the client supplied.
    applyTrustedIdentityHeaders(headers, req.identity);

    const init: RequestInit = { method: req.method, headers };
    if (!BODYLESS_METHODS.has(req.method)) {
      init.body = JSON.stringify(req.body ?? {});
    }

    // The action fetches AND reads the whole body under ONE AbortController, so
    // the timeout (and the breaker) cover a stalled body too — undici resolves
    // `fetch` as soon as headers arrive, so reading the body outside this region
    // would hang forever on a headers-then-stall upstream and be miscounted as a
    // breaker success. Resolves for ANY status (incl. 5xx — a downstream app bug,
    // not an unreachable downstream); rejects only on a network error or the
    // timeout's AbortError, which the breaker records as a failure. Nothing is
    // written to `res` until the full body is in hand, so a mid-body failure
    // never leaves a half-sent response.
    const action = async (): Promise<UpstreamResult> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
      try {
        const upstream = await fetch(targetUrl, { ...init, signal: controller.signal });
        const body = Buffer.from(await upstream.arrayBuffer());
        return { status: upstream.status, headers: upstream.headers, body };
      } finally {
        clearTimeout(timer);
      }
    };

    let result: UpstreamResult;
    try {
      result = await this.breakers.run(target.serviceName, action);
    } catch (err) {
      const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
      if (code === OPEN_BREAKER_ERROR_CODE) {
        // Breaker open for this downstream → fail fast, no fetch attempted.
        // Retry-After mirrors CB_RESET_TIMEOUT_MS (seconds, min 1); the body
        // carries no downstream internals.
        const retryAfterSec = Math.max(1, Math.round(this.breakers.resetTimeoutMs / 1000));
        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(503).json({ statusCode: 503, message: 'Service temporarily unavailable' });
        return;
      }
      // Upstream unreachable, too slow, or stalled mid-body → fail closed with a
      // gateway error, never a silent hang or a misleading 500 from the gateway.
      const timedOut = err instanceof Error && err.name === 'AbortError';
      const status = timedOut ? 504 : 502;
      res
        .status(status)
        .json({ statusCode: status, message: timedOut ? 'Upstream timed out' : 'Bad gateway' });
      return;
    }

    res.status(result.status);
    result.headers.forEach((value, key) => {
      if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    res.send(result.body);
  }
}
