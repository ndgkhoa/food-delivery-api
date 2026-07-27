import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { RATE_LIMIT_STORE, type RateLimitStore } from './rate-limit-store';
import { SKIP_RATE_LIMIT_KEY } from './skip-rate-limit.decorator';

/**
 * Global per-identity rate limiter. Registered AFTER `JwtAuthGuard`, so on a
 * protected route the verified `sub` is already attached and the limit follows
 * the identity across IPs; public routes (no identity) fall back to client IP.
 * Over the window threshold → 429 with `Retry-After`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly enabled: boolean;
  private readonly max: number;
  private readonly windowSec: number;

  constructor(
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    private readonly reflector: Reflector,
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
    // Routes marked `@SkipRateLimit()` (e.g. the health probe) bypass the limiter
    // entirely so high-frequency operational calls never trip a 429.
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const key = this.resolveKey(request);

    let count: number;
    let ttlSec: number;
    try {
      ({ count, ttlSec } = await this.store.hit(key, this.windowSec));
    } catch (err) {
      // Fail-open: the limiter is a protective edge layer, not a hard dependency.
      // If the store (Redis) is unreachable, ALLOW the request rather than 500 —
      // losing throttling briefly must never take the gateway (incl. login/refresh)
      // offline. The store keeps rejecting on error; the guard owns the policy.
      this.logger.warn(
        `rate-limit store unavailable, allowing request (key=${key}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return true;
    }
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
