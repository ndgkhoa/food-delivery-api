import { GRPC_TENANT_ID_METADATA } from '@food-delivery-api/shared-contracts';
import {
  type GrpcTenantVerifier,
  IDENTITY_SIG_HEADER,
  IDENTITY_TS_HEADER,
} from '@food-delivery-api/shared-tenancy';
import { status as GrpcStatus, type Metadata } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function firstMetadataValue(metadata: Metadata | undefined, key: string): string | undefined {
  const raw = metadata?.get(key)[0];
  return typeof raw === 'string' ? raw : raw?.toString();
}

export function readTenantFromMetadata(
  metadata: Metadata | undefined,
  verifier: GrpcTenantVerifier,
  now: number,
): string {
  const tenantId = firstMetadataValue(metadata, GRPC_TENANT_ID_METADATA);

  if (!tenantId || !UUID_REGEX.test(tenantId)) {
    throw new RpcException({
      code: GrpcStatus.UNAUTHENTICATED,
      message: 'Missing or invalid verified tenant identity',
    });
  }

  const verification = verifier.verify(
    tenantId,
    firstMetadataValue(metadata, IDENTITY_TS_HEADER),
    firstMetadataValue(metadata, IDENTITY_SIG_HEADER),
    now,
  );
  if (!verification.ok) {
    throw new RpcException({
      code: GrpcStatus.UNAUTHENTICATED,
      message: `Tenant identity signature rejected: ${verification.reason}`,
    });
  }

  return tenantId;
}
