import { Restaurant } from '@catalog/domain/restaurant/restaurant';

describe('Restaurant', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';

  describe('create', () => {
    it('creates a restaurant with defaults applied', () => {
      const restaurant = Restaurant.create({ id: 'r-1', tenantId, name: 'Pho House' });

      expect(restaurant.id).toBe('r-1');
      expect(restaurant.tenantId).toBe(tenantId);
      expect(restaurant.name).toBe('Pho House');
      expect(restaurant.description).toBeNull();
      expect(restaurant.isActive).toBe(true);
      expect(restaurant.deletedAt).toBeNull();
      expect(restaurant.createdAt).toEqual(restaurant.updatedAt);
    });

    it('trims the name', () => {
      const restaurant = Restaurant.create({ id: 'r-1', tenantId, name: '  Pho House  ' });
      expect(restaurant.name).toBe('Pho House');
    });

    it('rejects an empty name', () => {
      expect(() => Restaurant.create({ id: 'r-1', tenantId, name: '   ' })).toThrow(
        /name is required/i,
      );
    });

    it('rejects a name longer than 255 characters', () => {
      expect(() => Restaurant.create({ id: 'r-1', tenantId, name: 'a'.repeat(256) })).toThrow(
        /at most 255 characters/i,
      );
    });

    it('respects an explicit isActive/description override', () => {
      const restaurant = Restaurant.create({
        id: 'r-1',
        tenantId,
        name: 'Pho House',
        description: 'Great pho',
        isActive: false,
      });

      expect(restaurant.description).toBe('Great pho');
      expect(restaurant.isActive).toBe(false);
    });
  });

  describe('reconstitute', () => {
    it('rehydrates without re-validating (trusts persisted data)', () => {
      const now = new Date();
      const restaurant = Restaurant.reconstitute({
        id: 'r-1',
        tenantId,
        name: 'Pho House',
        description: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });

      expect(restaurant.name).toBe('Pho House');
    });
  });

  describe('update', () => {
    it('returns a new instance with merged changes and a bumped updatedAt', async () => {
      const restaurant = Restaurant.create({ id: 'r-1', tenantId, name: 'Original' });
      await new Promise((resolve) => setTimeout(resolve, 5));

      const updated = restaurant.update({ name: 'Updated', isActive: false });

      expect(updated).not.toBe(restaurant);
      expect(updated.name).toBe('Updated');
      expect(updated.isActive).toBe(false);
      expect(updated.updatedAt.getTime()).toBeGreaterThan(restaurant.updatedAt.getTime());
      expect(restaurant.name).toBe('Original');
    });

    it('keeps unspecified fields unchanged', () => {
      const restaurant = Restaurant.create({
        id: 'r-1',
        tenantId,
        name: 'Original',
        description: 'Keep me',
      });

      const updated = restaurant.update({ name: 'Updated' });

      expect(updated.description).toBe('Keep me');
    });

    it('rejects an invalid name on update', () => {
      const restaurant = Restaurant.create({ id: 'r-1', tenantId, name: 'Original' });
      expect(() => restaurant.update({ name: '' })).toThrow(/name is required/i);
    });
  });

  describe('toSnapshot', () => {
    it('returns a plain-object copy of the current state', () => {
      const restaurant = Restaurant.create({ id: 'r-1', tenantId, name: 'Pho House' });
      const snapshot = restaurant.toSnapshot();

      expect(snapshot).toMatchObject({ id: 'r-1', tenantId, name: 'Pho House' });
    });
  });
});
