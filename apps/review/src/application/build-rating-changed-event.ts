import type { OutboxCommandEntry } from '@review/domain/shared/outbox.port';

export const REVIEW_EVENTS_TOPIC = 'review.events';
const RESTAURANT_RATING_CHANGED = 'RestaurantRatingChanged';

interface RestaurantRatingChangedPayload {
  restaurantId: string;
  avgRating: number;
  reviewCount: number;
}

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
