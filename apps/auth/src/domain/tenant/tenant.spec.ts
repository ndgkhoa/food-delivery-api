import { Tenant } from '@auth/domain/tenant/tenant';

describe('Tenant', () => {
  describe('create', () => {
    it('creates a tenant with defaults applied', () => {
      const tenant = Tenant.create({ id: 't-1', name: 'Acme Foods', slug: 'acme-foods' });

      expect(tenant.id).toBe('t-1');
      expect(tenant.name).toBe('Acme Foods');
      expect(tenant.slug).toBe('acme-foods');
      expect(tenant.isActive).toBe(true);
      expect(tenant.createdAt).toEqual(tenant.updatedAt);
    });

    it('trims name and slug', () => {
      const tenant = Tenant.create({ id: 't-1', name: '  Acme  ', slug: '  acme  ' });
      expect(tenant.name).toBe('Acme');
      expect(tenant.slug).toBe('acme');
    });

    it('rejects an empty name', () => {
      expect(() => Tenant.create({ id: 't-1', name: '   ', slug: 'acme' })).toThrow(
        /name is required/i,
      );
    });

    it('rejects an empty slug', () => {
      expect(() => Tenant.create({ id: 't-1', name: 'Acme', slug: '   ' })).toThrow(
        /slug is required/i,
      );
    });

    it('rejects a non-kebab slug', () => {
      expect(() => Tenant.create({ id: 't-1', name: 'Acme', slug: 'Acme Foods' })).toThrow(
        /lowercase alphanumeric/i,
      );
      expect(() => Tenant.create({ id: 't-1', name: 'Acme', slug: 'acme--foods' })).toThrow(
        /lowercase alphanumeric/i,
      );
    });

    it('rejects a name longer than 255 characters', () => {
      expect(() => Tenant.create({ id: 't-1', name: 'a'.repeat(256), slug: 'acme' })).toThrow(
        /at most 255 characters/i,
      );
    });

    it('respects an explicit isActive override', () => {
      const tenant = Tenant.create({ id: 't-1', name: 'Acme', slug: 'acme', isActive: false });
      expect(tenant.isActive).toBe(false);
    });
  });

  describe('reconstitute', () => {
    it('rehydrates without re-validating (trusts persisted data)', () => {
      const now = new Date();
      const tenant = Tenant.reconstitute({
        id: 't-1',
        name: 'Acme',
        slug: 'acme',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      expect(tenant.slug).toBe('acme');
    });
  });
});
