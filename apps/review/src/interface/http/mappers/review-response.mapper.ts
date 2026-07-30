import type { Review } from '@review/domain/review/review';
import type { ReviewResponse } from '@review/interface/http/dto/review.response';

export class ReviewResponseMapper {
  static toResponse(review: Review): ReviewResponse {
    return {
      id: review.id,
      tenantId: review.tenantId,
      orderId: review.orderId,
      restaurantId: review.restaurantId,
      userId: review.userId,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
    };
  }
}
