import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';
import type { RestaurantSearchRepository } from '@search/domain/restaurant-search/restaurant-search.repository';

interface RestaurantSnapshot {
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

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
      return;
  }
}
