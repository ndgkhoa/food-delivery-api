import type { Review } from '@review/domain/review/review';

/** The recomputed aggregate — always the full current state (avg over ALL of a restaurant's reviews), never a delta. */
export interface RestaurantRatingAggregate {
  avgRating: number;
  reviewCount: number;
}

export interface ReviewRepository {
  /** Inserts the review row. Throws the raw unique-violation on a duplicate `order_id` — the caller translates it. */
  save(review: Review): Promise<Review>;
  /**
   * Recomputes a restaurant's rating aggregate FROM the reviews table (not an
   * incremental counter), so a redelivered submit can never double-count. Must
   * be called inside the same transaction as the triggering `save` to see it.
   */
  aggregateForRestaurant(
    tenantId: string,
    restaurantId: string,
  ): Promise<RestaurantRatingAggregate>;
}

export const REVIEW_REPOSITORY = Symbol('ReviewRepository');
