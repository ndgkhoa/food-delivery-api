import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { TenantContextService } from './tenant-context.service';

const TENANT_HEADER = 'x-tenant-id';
const ACTOR_HEADER = 'x-actor-id';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * DEV-ONLY multi-tenancy: trusts the `x-tenant-id` header as the tenant scope
 * for every request and propagates it via `TenantContextService` so every
 * downstream query/write is filtered/stamped by tenant. This header-trust
 * model is intentionally temporary — P1 (auth) replaces it with a `tenant_id`
 * claim verified from a signed JWT. Do not carry this interceptor into
 * production auth-gated traffic as-is.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const tenantId = firstHeaderValue(request.headers[TENANT_HEADER]);

    if (!tenantId || !UUID_REGEX.test(tenantId)) {
      throw new BadRequestException(`Missing or invalid required header "${TENANT_HEADER}"`);
    }

    const actor = firstHeaderValue(request.headers[ACTOR_HEADER]) || 'anonymous';

    return new Observable((subscriber) => {
      this.tenantContext.run({ tenantId, actor }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
