import { randomUUID } from 'node:crypto';
import { InvalidUuidError } from '@auth/domain/shared/errors';
import { assertValidTenantId } from '@auth/domain/shared/uuid';

describe('assertValidTenantId (M-2 guard)', () => {
  it('accepts a generated v4 UUID', () => {
    expect(() => assertValidTenantId(randomUUID())).not.toThrow();
  });

  it('accepts a canonical seeded UUID', () => {
    expect(() => assertValidTenantId('11111111-1111-4111-8111-111111111111')).not.toThrow();
  });

  it('rejects a non-UUID string', () => {
    expect(() => assertValidTenantId('not-a-uuid')).toThrow(InvalidUuidError);
  });

  it('rejects an empty string', () => {
    expect(() => assertValidTenantId('')).toThrow(InvalidUuidError);
  });

  it('rejects a numeric tenant id (the M-2 failure mode)', () => {
    expect(() => assertValidTenantId('12345')).toThrow(InvalidUuidError);
  });
});
