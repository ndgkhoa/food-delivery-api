import { UserTenantLink } from '@auth/domain/tenant/user-tenant-link';

function buildCreateProps(overrides: Partial<Parameters<typeof UserTenantLink.create>[0]> = {}) {
  return {
    id: 'link-1',
    keycloakUserId: 'kc-1',
    tenantId: 'tenant-1',
    role: 'customer',
    ...overrides,
  };
}

describe('UserTenantLink', () => {
  it('creates a link with the given props and a fresh createdAt timestamp', () => {
    const before = new Date();

    const link = UserTenantLink.create(buildCreateProps());

    expect(link.id).toBe('link-1');
    expect(link.keycloakUserId).toBe('kc-1');
    expect(link.tenantId).toBe('tenant-1');
    expect(link.role).toBe('customer');
    expect(link.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('rejects creation when keycloakUserId is missing', () => {
    expect(() => UserTenantLink.create(buildCreateProps({ keycloakUserId: '' }))).toThrow(
      'Keycloak user id is required',
    );
  });

  it('rejects creation when role is missing', () => {
    expect(() => UserTenantLink.create(buildCreateProps({ role: '' }))).toThrow('Role is required');
  });

  it('reconstitutes a link from persisted props without re-validating', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    const link = UserTenantLink.reconstitute({
      id: 'link-2',
      keycloakUserId: 'kc-2',
      tenantId: 'tenant-2',
      role: 'admin',
      createdAt,
    });

    expect(link.id).toBe('link-2');
    expect(link.keycloakUserId).toBe('kc-2');
    expect(link.tenantId).toBe('tenant-2');
    expect(link.role).toBe('admin');
    expect(link.createdAt).toBe(createdAt);
  });
});
