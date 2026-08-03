import { MenuItem } from '@catalog/domain/menu-item/menu-item';
import { Restaurant } from '@catalog/domain/restaurant/restaurant';
import { CatalogEventFactory } from '@catalog/domain/shared/catalog-event.factory';

describe('CatalogEventFactory', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const restaurantId = '22222222-2222-4222-8222-222222222222';

  const restaurant = Restaurant.reconstitute({
    id: restaurantId,
    tenantId,
    name: 'Pho House',
    description: null,
    isActive: true,
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
    updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    deletedAt: null,
    version: 3,
  });
  const menuItem = MenuItem.create({
    id: '33333333-3333-4333-8333-333333333333',
    tenantId,
    restaurantId,
    name: 'Pho Bo',
    priceCents: 8500,
  });

  it('routes every catalog event to the catalog aggregate type', () => {
    for (const entry of [
      CatalogEventFactory.restaurantCreated(restaurant),
      CatalogEventFactory.menuItemDeleted(menuItem),
    ]) {
      expect(entry.aggregateType).toBe('catalog');
    }
  });

  it('keys a restaurant event by the restaurant id and tags the type', () => {
    const entry = CatalogEventFactory.restaurantUpdated(restaurant);

    expect(entry.aggregateId).toBe(restaurantId);
    expect(entry.type).toBe('RestaurantUpdated');
    expect(entry.payload).toMatchObject({ id: restaurantId, tenantId, name: 'Pho House' });
  });

  it('carries the aggregate optimistic-lock version in the event payload — the read-model projector relies on this to keep GET in sync with PATCH', () => {
    const entry = CatalogEventFactory.restaurantUpdated(restaurant);

    expect(entry.payload).toMatchObject({ version: 3 });
  });

  it('keys a menu-item event by the menu-item id and carries its snapshot', () => {
    const entry = CatalogEventFactory.menuItemCreated(menuItem);

    expect(entry.aggregateId).toBe(menuItem.id);
    expect(entry.type).toBe('MenuItemCreated');
    expect(entry.payload).toMatchObject({
      id: menuItem.id,
      restaurantId,
      priceCents: 8500,
    });
  });

  it('emits the expected type string for each factory method', () => {
    expect(CatalogEventFactory.restaurantCreated(restaurant).type).toBe('RestaurantCreated');
    expect(CatalogEventFactory.restaurantDeleted(restaurant).type).toBe('RestaurantDeleted');
    expect(CatalogEventFactory.menuItemUpdated(menuItem).type).toBe('MenuItemUpdated');
    expect(CatalogEventFactory.menuItemDeleted(menuItem).type).toBe('MenuItemDeleted');
  });
});
