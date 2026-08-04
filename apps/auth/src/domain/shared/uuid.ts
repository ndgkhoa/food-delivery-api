import { InvalidUuidError } from '@auth/domain/shared/errors';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertValidTenantId(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidUuidError('tenant_id', value);
  }
}
