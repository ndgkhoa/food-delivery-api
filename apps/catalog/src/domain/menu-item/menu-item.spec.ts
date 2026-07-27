import { MenuItem } from './menu-item';

describe('MenuItem', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const restaurantId = '22222222-2222-4222-8222-222222222222';

  describe('create', () => {
    it('creates a menu item with defaults applied', () => {
      const menuItem = MenuItem.create({
        id: 'm-1',
        tenantId,
        restaurantId,
        name: 'Pho Bo',
        priceCents: 8500,
      });

      expect(menuItem.id).toBe('m-1');
      expect(menuItem.restaurantId).toBe(restaurantId);
      expect(menuItem.priceCents).toBe(8500);
      expect(menuItem.isAvailable).toBe(true);
      expect(menuItem.deletedAt).toBeNull();
    });

    it('rejects an empty name', () => {
      expect(() =>
        MenuItem.create({ id: 'm-1', tenantId, restaurantId, name: '  ', priceCents: 100 }),
      ).toThrow(/name is required/i);
    });

    it('rejects a negative priceCents', () => {
      expect(() =>
        MenuItem.create({ id: 'm-1', tenantId, restaurantId, name: 'Pho Bo', priceCents: -1 }),
      ).toThrow(/non-negative integer/i);
    });

    it('rejects a non-integer priceCents', () => {
      expect(() =>
        MenuItem.create({ id: 'm-1', tenantId, restaurantId, name: 'Pho Bo', priceCents: 12.5 }),
      ).toThrow(/non-negative integer/i);
    });

    it('accepts a zero priceCents (free item)', () => {
      const menuItem = MenuItem.create({
        id: 'm-1',
        tenantId,
        restaurantId,
        name: 'Free Sample',
        priceCents: 0,
      });
      expect(menuItem.priceCents).toBe(0);
    });
  });

  describe('update', () => {
    it('returns a new instance with merged changes', () => {
      const menuItem = MenuItem.create({
        id: 'm-1',
        tenantId,
        restaurantId,
        name: 'Pho Bo',
        priceCents: 8500,
      });

      const updated = menuItem.update({ priceCents: 9000, isAvailable: false });

      expect(updated).not.toBe(menuItem);
      expect(updated.priceCents).toBe(9000);
      expect(updated.isAvailable).toBe(false);
      expect(updated.name).toBe('Pho Bo');
      expect(menuItem.priceCents).toBe(8500);
    });

    it('rejects an invalid priceCents on update', () => {
      const menuItem = MenuItem.create({
        id: 'm-1',
        tenantId,
        restaurantId,
        name: 'Pho Bo',
        priceCents: 8500,
      });

      expect(() => menuItem.update({ priceCents: -5 })).toThrow(/non-negative integer/i);
    });
  });

  describe('toSnapshot', () => {
    it('returns a plain-object copy of the current state', () => {
      const menuItem = MenuItem.create({
        id: 'm-1',
        tenantId,
        restaurantId,
        name: 'Pho Bo',
        priceCents: 8500,
      });

      expect(menuItem.toSnapshot()).toMatchObject({ id: 'm-1', name: 'Pho Bo', priceCents: 8500 });
    });
  });
});
