import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { OutboxEntry } from '@catalog/domain/shared/outbox.port';

/**
 * Pure mapping from a domain aggregate + change kind to a CDC outbox entry.
 * Every catalog event shares `aggregateType='catalog'` so they all route to
 * the single `catalog.events` topic; the `type` field is what a consumer
 * switches on. The payload is the aggregate snapshot — the only writer of the
 * outbox payload shape, so the JSON structure is guaranteed for the SMT.
 *
 * Deletes still carry the last-known snapshot so a projection can resolve the
 * tenant/keys it needs to remove the read row.
 */
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
