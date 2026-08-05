import { CORRELATION_ID_HEADER } from '@food-delivery-api/shared-logging';
import { applyTrustedIdentityHeaders, signIdentity } from '@food-delivery-api/shared-tenancy';
import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { CircuitBreakerRegistry } from '@gateway/proxy/circuit-breaker.registry';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);
const SKIP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding']);
const FORWARD_TIMEOUT_MS = 10_000;
const FORWARDED_CLIENT_HEADERS = ['idempotency-key'];
const OPEN_BREAKER_ERROR_CODE = 'EOPENBREAKER';

export interface ForwardTarget {
  gatewayPrefix: string;
  baseUrl: string;
  serviceName: string;
}

interface UpstreamResult {
  status: number;
  headers: Headers;
  body: Buffer;
}

@Injectable()
export class HttpForwarder {
  constructor(
    private readonly breakers: CircuitBreakerRegistry,
    private readonly config: ConfigService,
  ) {}

  async forward(req: AuthenticatedRequest, res: Response, target: ForwardTarget): Promise<void> {
    if (!req.identity) {
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
    for (const name of FORWARDED_CLIENT_HEADERS) {
      const value = req.headers[name];
      if (typeof value === 'string') {
        headers[name] = value;
      }
    }
    const signingKey = this.config.get<string>('INTERNAL_IDENTITY_SIGNING_KEY');
    applyTrustedIdentityHeaders(
      headers,
      req.identity,
      signingKey ? (identity, ts) => signIdentity(signingKey, identity, ts) : undefined,
    );

    const init: RequestInit = { method: req.method, headers };
    if (!BODYLESS_METHODS.has(req.method)) {
      init.body = JSON.stringify(req.body ?? {});
    }

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
        const retryAfterSec = Math.max(1, Math.round(this.breakers.resetTimeoutMs / 1000));
        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(503).json({ statusCode: 503, message: 'Service temporarily unavailable' });
        return;
      }
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
