import { extractIdentity, MissingIdentityClaimError } from './identity';

describe('extractIdentity', () => {
  it('extracts sub, tenantId and Keycloak realm roles', () => {
    const identity = extractIdentity({
      sub: 'user-1',
      tenant_id: 'tenant-abc',
      realm_access: { roles: ['admin', 'customer'] },
    });

    expect(identity).toEqual({
      sub: 'user-1',
      tenantId: 'tenant-abc',
      roles: ['admin', 'customer'],
    });
  });

  it('falls back to a flat roles claim when realm_access is absent', () => {
    const identity = extractIdentity({ sub: 'u', tenant_id: 't', roles: ['driver'] });
    expect(identity.roles).toEqual(['driver']);
  });

  it('defaults roles to an empty array when none are present', () => {
    const identity = extractIdentity({ sub: 'u', tenant_id: 't' });
    expect(identity.roles).toEqual([]);
  });

  it('throws when the sub claim is missing', () => {
    expect(() => extractIdentity({ tenant_id: 't' })).toThrow(MissingIdentityClaimError);
  });

  it('throws when the tenant_id claim is missing', () => {
    expect(() => extractIdentity({ sub: 'u' })).toThrow(MissingIdentityClaimError);
  });
});
