import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';
import type { RestaurantSearchRepository } from '@search/domain/restaurant-search/restaurant-search.repository';

interface RestaurantRatingChangedPayload {
  avgRating: number;
}

export async function applyReviewRatingEvent(
  envelope: EventEnvelopeHeaders,
  payload: unknown,
  repository: RestaurantSearchRepository,
): Promise<void> {
  if (envelope.eventType !== 'RestaurantRatingChanged') {
    return;
  }
  const { avgRating } = payload as RestaurantRatingChangedPayload;
  await repository.updateRating(envelope.aggregateId, envelope.tenantId, avgRating);
}
