import { GRPC_TENANT_ID_METADATA } from '@food-delivery-api/shared-contracts';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
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

/**
 * gRPC counterpart of the HTTP trusted-identity interceptor: establishes the
 * request's tenant scope from the `x-tenant-id` gRPC metadata the calling
 * service propagates from its verified identity. Fails closed with
 * UNAUTHENTICATED when the metadata is absent/malformed, so an internal call
 * can never run unscoped. The request body's `tenantId` is never trusted here.
 */
@Injectable()
export class GrpcTenantContextInterceptor implements NestInterceptor {
  constructor(@Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = context.switchToRpc().getContext<Metadata>();
    const raw = metadata.get(GRPC_TENANT_ID_METADATA)[0];
    const tenantId = typeof raw === 'string' ? raw : raw?.toString();

    if (!tenantId || !UUID_REGEX.test(tenantId)) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing or invalid verified tenant identity',
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
