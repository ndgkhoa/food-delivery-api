import type { JWTPayload } from 'jose';

export interface VerifiedIdentity {
  sub: string;
  tenantId: string;
  roles: string[];
}

export class MissingIdentityClaimError extends Error {
  constructor(claim: string) {
    super(`Verified token is missing the required "${claim}" claim`);
    this.name = 'MissingIdentityClaimError';
  }
}

function extractRoles(payload: JWTPayload): string[] {
  const realmAccess = payload.realm_access as { roles?: unknown } | undefined;
  const source = Array.isArray(realmAccess?.roles)
    ? realmAccess.roles
    : Array.isArray((payload as { roles?: unknown }).roles)
      ? (payload as { roles: unknown[] }).roles
      : [];
  return source.filter((role): role is string => typeof role === 'string');
}

export function extractIdentity(payload: JWTPayload): VerifiedIdentity {
  const sub = payload.sub;
  if (!sub) {
    throw new MissingIdentityClaimError('sub');
  }
  const tenantClaim = payload.tenant_id;
  if (typeof tenantClaim !== 'string' || tenantClaim.length === 0) {
    throw new MissingIdentityClaimError('tenant_id');
  }
  return { sub, tenantId: tenantClaim, roles: extractRoles(payload) };
}
