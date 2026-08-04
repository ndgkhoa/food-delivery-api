import type { ReadRestaurantRepository } from '@catalog/domain/read-model/read-restaurant.repository';
import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';

interface RestaurantRatingChangedPayload {
  avgRating: number;
  reviewCount: number;
}

export async function applyReviewEvent(
  envelope: EventEnvelopeHeaders,
  payload: unknown,
  restaurants: ReadRestaurantRepository,
): Promise<void> {
  if (envelope.eventType !== 'RestaurantRatingChanged') {
    return;
  }
  const { avgRating, reviewCount } = payload as RestaurantRatingChangedPayload;
  await restaurants.updateRating(envelope.aggregateId, envelope.tenantId, avgRating, reviewCount);
}
