import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';
import type { RestaurantSearchRepository } from '@search/domain/restaurant-search/restaurant-search.repository';

/** Payload the review service publishes on `review.events`. */
interface RestaurantRatingChangedPayload {
  avgRating: number;
}

/**
 * Applies one `review.events` event to the ES restaurant document, dispatching
 * on the envelope type. Tenant + aggregate id come from the trusted envelope
 * (never the payload) — mirrors `applyRestaurantSearchEvent`'s shape for the
 * `catalog.events` topic. Pure over the repository port so the mapping is
 * unit-testable without a live Elasticsearch node.
 */
export async function applyReviewRatingEvent(
  envelope: EventEnvelopeHeaders,
  payload: unknown,
  repository: RestaurantSearchRepository,
): Promise<void> {
  if (envelope.eventType !== 'RestaurantRatingChanged') {
    // Unknown type on a shared topic: ignore rather than fail the partition.
    return;
  }
  const { avgRating } = payload as RestaurantRatingChangedPayload;
  await repository.updateRating(envelope.aggregateId, envelope.tenantId, avgRating);
}
