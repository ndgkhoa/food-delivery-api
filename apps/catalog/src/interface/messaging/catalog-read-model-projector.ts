import type { ReadMenuItemRepository } from '@catalog/domain/read-model/read-menu-item.repository';
import type { ReadRestaurantRepository } from '@catalog/domain/read-model/read-restaurant.repository';
import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';

/** Snapshot shape emitted by the outbox factory (dates arrive as ISO strings over JSON). */
interface RestaurantSnapshot {
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MenuItemSnapshot {
  restaurantId: string;
  name: string;
  description: string | null;
  priceCents: number;
  isAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogReadModelRepositories {
  restaurants: ReadRestaurantRepository;
  menuItems: ReadMenuItemRepository;
}

/**
 * Applies one catalog event to the read model, dispatching on the envelope's
 * event type. Tenant + aggregate id come from the trusted envelope headers (not
 * the payload); the payload supplies the denormalized fields. Deletes drop the
 * read row(s): a restaurant delete both bulk-removes its menu-item read rows
 * (immediate cleanup) AND the delete handler emits a per-item MenuItemDeleted so
 * each item's own partition carries its terminal event — the bulk removal alone
 * couldn't be ordered against an in-flight item update on another partition.
 *
 * Pure over its repository ports so the type→effect mapping is unit-testable
 * without Kafka or a database.
 */
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
      // Unknown type on a shared topic: ignore rather than fail the partition.
      return;
  }
}
