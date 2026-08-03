import { GRPC_TENANT_ID_METADATA } from '@food-delivery-api/shared-contracts';
import {
  GRPC_TENANT_VERIFIER,
  type GrpcTenantVerifier,
  IDENTITY_SIG_HEADER,
  IDENTITY_TS_HEADER,
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
} from '@food-delivery-api/shared-tenancy';
import { status as GrpcStatus, type Metadata } from '@grpc/grpc-js';
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable } from 'rxjs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Node collapses a repeated gRPC metadata entry into an array; take the first value only. */
function firstMetadataValue(metadata: Metadata, key: string): string | undefined {
  const raw = metadata.get(key)[0];
  return typeof raw === 'string' ? raw : raw?.toString();
}

/**
 * gRPC counterpart of the HTTP trusted-identity interceptor: establishes the
 * request's tenant scope from the `x-tenant-id` gRPC metadata the calling
 * service propagates from its verified identity, and — when signature
 * enforcement is on — verifies the HMAC order stamped on that metadata
 * (`x-identity-ts`/`x-identity-sig`) so a caller reaching catalog directly
 * can't forge the tenant id. Fails closed with UNAUTHENTICATED on either
 * check, BEFORE establishing tenant context, so an internal call can never
 * run unscoped or mis-scoped. The request body's `tenantId` is never trusted here.
 */
@Injectable()
export class GrpcTenantContextInterceptor implements NestInterceptor {
  constructor(
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(GRPC_TENANT_VERIFIER) private readonly tenantVerifier: GrpcTenantVerifier,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = context.switchToRpc().getContext<Metadata>();
    const tenantId = firstMetadataValue(metadata, GRPC_TENANT_ID_METADATA);

    if (!tenantId || !UUID_REGEX.test(tenantId)) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing or invalid verified tenant identity',
      });
    }

    const verification = this.tenantVerifier.verify(
      tenantId,
      firstMetadataValue(metadata, IDENTITY_TS_HEADER),
      firstMetadataValue(metadata, IDENTITY_SIG_HEADER),
      Date.now(),
    );
    if (!verification.ok) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: `Tenant identity signature rejected: ${verification.reason}`,
      });
    }

    // `actor: system` — east-west calls act on behalf of the calling service,
    // not an end user; RBAC on writes stays at the public HTTP edge.
    return new Observable((subscriber) => {
      this.tenantContext.run({ tenantId, actor: 'system', roles: [] }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
