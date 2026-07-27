import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { TENANT_ID_HEADER, USER_ID_HEADER } from './identity-headers';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from './tenant-context.port';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Establishes the request's tenant context from the identity the gateway
 * derived from a VERIFIED token and propagated via trusted headers. This
 * replaces the earlier dev-only model that trusted a client-supplied
 * `x-tenant-id` directly — the tenant now originates solely from the token
 * claim, stamped by the gateway (which strips any client copy first).
 *
 * Fails closed with 401 when the trusted tenant header is absent/malformed:
 * a request must never run unscoped.
 */
@Injectable()
export class TrustedIdentityInterceptor implements NestInterceptor {
  constructor(@Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const tenantId = firstHeaderValue(request.headers[TENANT_ID_HEADER]);

    if (!tenantId || !UUID_REGEX.test(tenantId)) {
      throw new UnauthorizedException('Missing or invalid verified tenant identity');
    }

    const actor = firstHeaderValue(request.headers[USER_ID_HEADER]) || 'anonymous';

    return new Observable((subscriber) => {
      this.tenantContext.run({ tenantId, actor }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
