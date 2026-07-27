import { applyTrustedIdentityHeaders } from '@food-delivery-api/shared-tenancy';

/**
 * Builds the trusted-identity headers the gateway's `TrustedIdentityInterceptor`
 * expects, standing in for the gateway in these e2e tests — supertest talks
 * to the order app directly, so the "verified identity" has to be stamped by
 * hand exactly as `applyTrustedIdentityHeaders` would.
 */
export function buildIdentityHeaders(
  tenantId: string,
  userId: string,
  roles: string[] = [],
): Record<string, string> {
  const headers: Record<string, string> = {};
  applyTrustedIdentityHeaders(headers, { sub: userId, tenantId, roles });
  return headers;
}
