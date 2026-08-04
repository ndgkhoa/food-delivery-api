import { GRPC_TENANT_ID_METADATA } from '@food-delivery-api/shared-contracts';
import {
  IDENTITY_SIG_HEADER,
  IDENTITY_TS_HEADER,
  signGrpcTenant,
} from '@food-delivery-api/shared-tenancy';
import { Metadata } from '@grpc/grpc-js';

export function buildTenantMetadata(tenantId: string): Metadata {
  const metadata = new Metadata();
  metadata.set(GRPC_TENANT_ID_METADATA, tenantId);

  const key = process.env.INTERNAL_IDENTITY_SIGNING_KEY;
  if (key) {
    const ts = Date.now();
    metadata.set(IDENTITY_TS_HEADER, String(ts));
    metadata.set(IDENTITY_SIG_HEADER, signGrpcTenant(key, tenantId, ts));
  }

  return metadata;
}
