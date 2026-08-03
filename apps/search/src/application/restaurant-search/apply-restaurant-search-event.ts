import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';
import type { RestaurantSearchRepository } from '@search/domain/restaurant-search/restaurant-search.repository';

/** Restaurant snapshot the outbox emits (dates arrive as ISO strings over JSON). */
interface RestaurantSnapshot {
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Applies one `catalog.events` event to the search read model, dispatching on
 * the envelope type. Tenant + aggregate id come from the trusted envelope (never
 * the payload). `version` is the event occurrence time in epoch millis — a
 * per-aggregate monotonic guard the adapter maps to ES external versioning so a
 * stale/redelivered event cannot overwrite newer state or resurrect a delete.
 *
 * Pure over the repository port so the type→effect mapping is unit-testable
 * without Kafka or a live Elasticsearch node.
 *
 * Menu-item events are intentionally ignored for now — this slice indexes
 * restaurants only. TODO: project menu items into their own doc type/index when
 * menu search is added (a later slice), keyed by menu-item id + restaurantId.
 */
export async function applyRestaurantSearchEvent(
  envelope: EventEnvelopeHeaders,
  payload: unknown,
  repository: RestaurantSearchRepository,
): Promise<void> {
  const { eventType, aggregateId, tenantId } = envelope;
  const version = Date.parse(envelope.occurredAt);

  switch (eventType) {
    case 'RestaurantCreated':
    case 'RestaurantUpdated': {
      const snapshot = payload as RestaurantSnapshot;
      await repository.upsert({
        id: aggregateId,
        tenantId,
        name: snapshot.name,
        description: snapshot.description,
        isActive: snapshot.isActive,
        // Ratings arrive with review events in a later slice; default 0 keeps the
        // function_score wiring live without inventing fake data.
        rating: 0,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        version,
      });
      return;
    }
    case 'RestaurantDeleted': {
      await repository.remove(aggregateId, tenantId, version);
      return;
    }
    default:
      // Menu-item events + any unknown type on the shared topic: ignore rather
      // than fail the partition.
      return;
  }
}
