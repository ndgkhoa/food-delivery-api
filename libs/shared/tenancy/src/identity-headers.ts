/**
 * Header contract for propagating a VERIFIED identity from the gateway to
 * downstream services. The gateway is the single trust boundary: it verifies
 * the JWT, then stamps these headers from the token claims. Downstream
 * services read them via the trusted-identity interceptor.
 *
 * Clients can never set these directly — the gateway strips any inbound copy
 * before stamping the verified values (see `stripClientIdentityHeaders` +
 * `applyTrustedIdentityHeaders`), so a spoofed `x-tenant-id` is always ignored.
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
 * Removes any client-supplied identity headers from an outbound header set so
 * a caller can never smuggle a tenant/user/role claim past the gateway.
 */
export function stripClientIdentityHeaders(headers: Record<string, unknown>): void {
  delete headers[TENANT_ID_HEADER];
  delete headers[USER_ID_HEADER];
  delete headers[ROLES_HEADER];
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
