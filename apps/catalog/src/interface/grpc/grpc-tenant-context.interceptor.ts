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

function firstMetadataValue(metadata: Metadata, key: string): string | undefined {
  const raw = metadata.get(key)[0];
  return typeof raw === 'string' ? raw : raw?.toString();
}

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

    return new Observable((subscriber) => {
      this.tenantContext.run({ tenantId, actor: 'system', roles: [] }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
