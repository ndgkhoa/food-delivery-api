/**
 * Header contract for propagating a VERIFIED identity from the gateway to
 * downstream services. The gateway is the single trust boundary: it verifies
 * the JWT, then stamps these headers from the token claims. Downstream
 * services read them via the trusted-identity interceptor.
 *
 * Clients can never set these directly — the gateway builds the outbound header
 * set from scratch and stamps only the verified values (`applyTrustedIdentityHeaders`),
 * so a client-supplied `x-tenant-id` is never propagated downstream.
 */
export const TENANT_ID_HEADER = 'x-tenant-id';
export const USER_ID_HEADER = 'x-user-id';
export const ROLES_HEADER = 'x-roles';

export interface PropagatedIdentity {
  sub: string;
  tenantId: string;
  roles: string[];
}

/**
 * Stamps the VERIFIED identity onto an outbound header set, overwriting
 * anything already present. This is the only source of the identity headers
 * a downstream service will ever trust.
 */
export function applyTrustedIdentityHeaders(
  headers: Record<string, string>,
  identity: PropagatedIdentity,
): void {
  headers[TENANT_ID_HEADER] = identity.tenantId;
  headers[USER_ID_HEADER] = identity.sub;
  headers[ROLES_HEADER] = identity.roles.join(',');
}

/** Node collapses a repeated header into an array; take the first value only. */
export function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Splits the comma-joined `x-roles` header back into a role list (empty when absent). */
export function parseRolesHeader(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
}
