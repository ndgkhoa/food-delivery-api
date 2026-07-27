import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { RATE_LIMIT_STORE, type RateLimitStore } from './rate-limit-store';

/**
 * Global per-identity rate limiter. Registered AFTER `JwtAuthGuard`, so on a
 * protected route the verified `sub` is already attached and the limit follows
 * the identity across IPs; public routes (no identity) fall back to client IP.
 * Over the window threshold → 429 with `Retry-After`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly enabled: boolean;
  private readonly max: number;
  private readonly windowSec: number;

  constructor(
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    config: ConfigService,
  ) {
    // Tolerate both the zod-transformed boolean and the raw env string:
    // ConfigService may return the un-transformed `process.env` value, and the
    // string "false" is truthy — so compare against the falsy forms explicitly.
    const enabled = config.get('RATE_LIMIT_ENABLED');
    this.enabled = enabled !== false && enabled !== 'false';
    this.max = Number(config.getOrThrow('RATE_LIMIT_MAX'));
    this.windowSec = Number(config.getOrThrow('RATE_LIMIT_WINDOW_SEC'));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.enabled) {
      return true;
    }
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const { count, ttlSec } = await this.store.hit(this.resolveKey(request), this.windowSec);
    if (count > this.max) {
      // Set the header on the live response before throwing — the exception
      // filter serialises the same object, so `Retry-After` survives.
      http.getResponse<Response>().setHeader('Retry-After', String(ttlSec));
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Rate limit exceeded' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private resolveKey(request: AuthenticatedRequest): string {
    const sub = request.identity?.sub;
    if (sub) {
      return `rl:sub:${sub}`;
    }
    // Use the socket-derived `req.ip` rather than a client-supplied
    // `X-Forwarded-For` so an unauthenticated caller cannot rotate the header to
    // dodge the limit. (Behind a trusted proxy, configure Express `trust proxy`
    // so `req.ip` reflects the real client.)
    return `rl:ip:${request.ip ?? 'unknown'}`;
  }
}
