import type { ReadMenuItemRepository } from '@catalog/domain/read-model/read-menu-item.repository';
import type { ReadRestaurantRepository } from '@catalog/domain/read-model/read-restaurant.repository';
import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';

interface RestaurantSnapshot {
  name: string;
  description: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface MenuItemSnapshot {
  restaurantId: string;
  name: string;
  description: string | null;
  priceCents: number;
  isAvailable: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogReadModelRepositories {
  restaurants: ReadRestaurantRepository;
  menuItems: ReadMenuItemRepository;
}

export async function applyCatalogEvent(
  envelope: EventEnvelopeHeaders,
  payload: unknown,
  repos: CatalogReadModelRepositories,
): Promise<void> {
  const { eventType, aggregateId, tenantId } = envelope;

  switch (eventType) {
    case 'RestaurantCreated':
    case 'RestaurantUpdated': {
      const snapshot = payload as RestaurantSnapshot;
      await repos.restaurants.upsert({
        id: aggregateId,
        tenantId,
        name: snapshot.name,
        description: snapshot.description,
        isActive: snapshot.isActive,
        version: snapshot.version,
        createdAt: new Date(snapshot.createdAt),
        updatedAt: new Date(snapshot.updatedAt),
      });
      return;
    }
    case 'RestaurantDeleted': {
      await repos.restaurants.remove(aggregateId, tenantId);
      await repos.menuItems.removeByRestaurant(aggregateId, tenantId);
      return;
    }
    case 'MenuItemCreated':
    case 'MenuItemUpdated': {
      const snapshot = payload as MenuItemSnapshot;
      await repos.menuItems.upsert({
        id: aggregateId,
        restaurantId: snapshot.restaurantId,
        tenantId,
        name: snapshot.name,
        description: snapshot.description,
        priceCents: snapshot.priceCents,
        isAvailable: snapshot.isAvailable,
        version: snapshot.version,
        createdAt: new Date(snapshot.createdAt),
        updatedAt: new Date(snapshot.updatedAt),
      });
      return;
    }
    case 'MenuItemDeleted': {
      await repos.menuItems.remove(aggregateId, tenantId);
      return;
    }
    default:
      return;
  }
}
