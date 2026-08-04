import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { OutboxEntry } from '@catalog/domain/shared/outbox.port';

const AGGREGATE_TYPE = 'catalog';

function restaurantEntry(restaurant: Restaurant, type: string): OutboxEntry {
  return {
    aggregateType: AGGREGATE_TYPE,
    aggregateId: restaurant.id,
    type,
    payload: restaurant.toSnapshot(),
  };
}

function menuItemEntry(menuItem: MenuItem, type: string): OutboxEntry {
  return {
    aggregateType: AGGREGATE_TYPE,
    aggregateId: menuItem.id,
    type,
    payload: menuItem.toSnapshot(),
  };
}

export const CatalogEventFactory = {
  restaurantCreated: (restaurant: Restaurant): OutboxEntry =>
    restaurantEntry(restaurant, 'RestaurantCreated'),
  restaurantUpdated: (restaurant: Restaurant): OutboxEntry =>
    restaurantEntry(restaurant, 'RestaurantUpdated'),
  restaurantDeleted: (restaurant: Restaurant): OutboxEntry =>
    restaurantEntry(restaurant, 'RestaurantDeleted'),
  menuItemCreated: (menuItem: MenuItem): OutboxEntry => menuItemEntry(menuItem, 'MenuItemCreated'),
  menuItemUpdated: (menuItem: MenuItem): OutboxEntry => menuItemEntry(menuItem, 'MenuItemUpdated'),
  menuItemDeleted: (menuItem: MenuItem): OutboxEntry => menuItemEntry(menuItem, 'MenuItemDeleted'),
} as const;
