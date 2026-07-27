import { GRPC_TENANT_ID_METADATA } from '@food-delivery-api/shared-contracts';
import { Metadata } from '@grpc/grpc-js';

/** Stamps the verified tenant onto outbound gRPC metadata — the only channel the callee trusts. */
export function buildTenantMetadata(tenantId: string): Metadata {
  const metadata = new Metadata();
  metadata.set(GRPC_TENANT_ID_METADATA, tenantId);
  return metadata;
}
