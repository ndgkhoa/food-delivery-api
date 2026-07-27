import { InvalidUuidError } from '@auth/domain/shared/errors';

// RFC 4122 canonical form, versions 1-5. Matches what `crypto.randomUUID()` (v4) emits.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Guards the M-2 invariant: the `tenant_id` set on a Keycloak user MUST be a
 * valid UUID so every token minted for that user later carries a valid
 * `tenant_id` claim. New tenants get a generated UUID; anything else is rejected
 * here rather than silently stamping a malformed claim.
 */
export function assertValidTenantId(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidUuidError('tenant_id', value);
  }
}
