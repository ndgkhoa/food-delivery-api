import { applyTrustedIdentityHeaders } from '@food-delivery-api/shared-tenancy';

export function buildIdentityHeaders(
  tenantId: string,
  userId: string,
  roles: string[] = [],
): Record<string, string> {
  const headers: Record<string, string> = {};
  applyTrustedIdentityHeaders(headers, { sub: userId, tenantId, roles });
  return headers;
}
