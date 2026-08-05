export const TENANT_ID_HEADER = 'x-tenant-id';
export const USER_ID_HEADER = 'x-user-id';
export const ROLES_HEADER = 'x-roles';
export const IDENTITY_TS_HEADER = 'x-identity-ts';
export const IDENTITY_SIG_HEADER = 'x-identity-sig';

export interface PropagatedIdentity {
  sub: string;
  tenantId: string;
  roles: string[];
}

export function applyTrustedIdentityHeaders(
  headers: Record<string, string>,
  identity: PropagatedIdentity,
  signer?: (identity: PropagatedIdentity, ts: number) => string,
): void {
  headers[TENANT_ID_HEADER] = identity.tenantId;
  headers[USER_ID_HEADER] = identity.sub;
  headers[ROLES_HEADER] = identity.roles.join(',');
  if (signer) {
    const ts = Date.now();
    headers[IDENTITY_TS_HEADER] = String(ts);
    headers[IDENTITY_SIG_HEADER] = signer(identity, ts);
  }
}

export function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseRolesHeader(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
}
