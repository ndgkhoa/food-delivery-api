import { GRPC_TENANT_ID_METADATA } from '@food-delivery-api/shared-contracts';
import {
  IDENTITY_SIG_HEADER,
  IDENTITY_TS_HEADER,
  signGrpcTenant,
} from '@food-delivery-api/shared-tenancy';
import { Metadata } from '@grpc/grpc-js';

/**
 * Stamps the verified tenant onto outbound gRPC metadata — the only channel
 * the callee trusts. When `INTERNAL_IDENTITY_SIGNING_KEY` is configured, also
 * HMAC-signs the tenant id (`x-identity-ts`/`x-identity-sig`) so catalog and
 * inventory can reject a call that didn't originate from a caller holding the
 * shared key. Reads `process.env` directly rather than through Nest's
 * `ConfigService` — this is a plain pure helper called from adapters with no
 * DI container to source one from, the same pattern `resolveIdentityEnforcement`
 * uses. Without a configured key, metadata is stamped unsigned exactly as
 * before; services with signature enforcement off (e.g. `NODE_ENV=test`)
 * still accept it.
 */
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
