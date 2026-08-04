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
import {
  firstHeaderValue,
  parseRolesHeader,
  ROLES_HEADER,
  TENANT_ID_HEADER,
  USER_ID_HEADER,
} from './identity-headers';
import { IDENTITY_SIGNATURE_VERIFIER, type IdentitySignatureVerifier } from './identity-signature';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from './tenant-context.port';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class TrustedIdentityInterceptor implements NestInterceptor {
  constructor(
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(IDENTITY_SIGNATURE_VERIFIER)
    private readonly signatureVerifier: IdentitySignatureVerifier,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const tenantId = firstHeaderValue(request.headers[TENANT_ID_HEADER]);

    if (!tenantId || !UUID_REGEX.test(tenantId)) {
      throw new UnauthorizedException('Missing or invalid verified tenant identity');
    }

    const signatureCheck = this.signatureVerifier.verify(request.headers, Date.now());
    if (!signatureCheck.ok) {
      throw new UnauthorizedException(
        `Invalid internal identity signature: ${signatureCheck.reason}`,
      );
    }

    const actor = firstHeaderValue(request.headers[USER_ID_HEADER]) || 'anonymous';
    const roles = parseRolesHeader(firstHeaderValue(request.headers[ROLES_HEADER]));

    return new Observable((subscriber) => {
      this.tenantContext.run({ tenantId, actor, roles }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
