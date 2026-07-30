import type { ReadRestaurantRepository } from '@catalog/domain/read-model/read-restaurant.repository';
import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';

/** Payload the review service publishes on `review.events`. */
interface RestaurantRatingChangedPayload {
  avgRating: number;
  reviewCount: number;
}

/**
 * Applies one `review.events` event to the restaurant read model. The
 * envelope's `aggregateId` is the restaurant id (the review service keys the
 * event by restaurant, giving per-restaurant ordering); tenant comes from the
 * envelope too, never the payload. `updateRating` always writes the freshly
 * recomputed aggregate (never a delta), so a redelivered or slightly
 * out-of-order event converges to the same last-write-wins result.
 *
 * Pure over the repository port so the type→effect mapping is unit-testable
 * without Kafka or a database.
 */
export async function applyReviewEvent(
  envelope: EventEnvelopeHeaders,
  payload: unknown,
  restaurants: ReadRestaurantRepository,
): Promise<void> {
  if (envelope.eventType !== 'RestaurantRatingChanged') {
    // Unknown type on a shared topic: ignore rather than fail the partition.
    return;
  }
  const { avgRating, reviewCount } = payload as RestaurantRatingChangedPayload;
  await restaurants.updateRating(envelope.aggregateId, envelope.tenantId, avgRating, reviewCount);
}
