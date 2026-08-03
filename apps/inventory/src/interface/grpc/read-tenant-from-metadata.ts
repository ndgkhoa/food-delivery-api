import { GRPC_TENANT_ID_METADATA } from '@food-delivery-api/shared-contracts';
import { status as GrpcStatus, type Metadata } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Extracts the verified tenant from gRPC metadata (`x-tenant-id`), the authority
 * on tenant scope for an internal call — the request body's tenantId is never
 * trusted. Fails closed with UNAUTHENTICATED so a call can never run unscoped.
 */
export function readTenantFromMetadata(metadata: Metadata | undefined): string {
  const raw = metadata?.get(GRPC_TENANT_ID_METADATA)[0];
  const tenantId = typeof raw === 'string' ? raw : raw?.toString();

  if (!tenantId || !UUID_REGEX.test(tenantId)) {
    throw new RpcException({
      code: GrpcStatus.UNAUTHENTICATED,
      message: 'Missing or invalid verified tenant identity',
    });
  }
  return tenantId;
}
