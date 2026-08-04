import type { Review } from '@review/domain/review/review';

export interface RestaurantRatingAggregate {
  avgRating: number;
  reviewCount: number;
}

export interface ReviewRepository {
  save(review: Review): Promise<Review>;
  aggregateForRestaurant(
    tenantId: string,
    restaurantId: string,
  ): Promise<RestaurantRatingAggregate>;
}

export const REVIEW_REPOSITORY = Symbol('ReviewRepository');
