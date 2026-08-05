import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { RATE_LIMIT_STORE, type RateLimitStore } from '@gateway/rate-limit/rate-limit-store';
import { SKIP_RATE_LIMIT_KEY } from '@gateway/rate-limit/skip-rate-limit.decorator';
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
    const enabled = config.get('RATE_LIMIT_ENABLED');
    this.enabled = enabled !== false && enabled !== 'false';
    this.max = Number(config.getOrThrow('RATE_LIMIT_MAX'));
    this.windowSec = Number(config.getOrThrow('RATE_LIMIT_WINDOW_SEC'));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.enabled) {
      return true;
    }
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
      this.logger.warn(
        `rate-limit store unavailable, allowing request (key=${key}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return true;
    }
    if (count > this.max) {
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
    return `rl:ip:${request.ip ?? 'unknown'}`;
  }
}
