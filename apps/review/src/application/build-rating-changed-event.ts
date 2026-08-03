import type { OutboxCommandEntry } from '@review/domain/shared/outbox.port';

/** Also used by `ReviewOutboxRelayProvider` to ensure the topic exists on boot. */
export const REVIEW_EVENTS_TOPIC = 'review.events';
const RESTAURANT_RATING_CHANGED = 'RestaurantRatingChanged';

/** Payload every `RestaurantRatingChanged` event carries. */
interface RestaurantRatingChangedPayload {
  restaurantId: string;
  avgRating: number;
  reviewCount: number;
}

/**
 * Builds the `RestaurantRatingChanged` event appended to the outbox in the
 * same transaction as a review insert. Keyed by RESTAURANT id (not review
 * id) — the Kafka message key becomes the partition key, so catalog's and
 * search's projectors always see one restaurant's rating changes in order,
 * even though the recompute is idempotent (recomputed from source) either way.
 */
export function restaurantRatingChangedEvent(
  restaurantId: string,
  avgRating: number,
  reviewCount: number,
): OutboxCommandEntry {
  return {
    aggregateId: restaurantId,
    topic: REVIEW_EVENTS_TOPIC,
    eventType: RESTAURANT_RATING_CHANGED,
    payload: { restaurantId, avgRating, reviewCount } satisfies RestaurantRatingChangedPayload,
  };
}
