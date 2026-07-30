import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Review } from '@review/domain/review/review';
import type {
  RestaurantRatingAggregate,
  ReviewRepository,
} from '@review/domain/review/review.repository';
import { ReviewOrmEntity } from '@review/infrastructure/persistence/entities/review.orm-entity';
import { getTransactionalEntityManager } from '@review/infrastructure/persistence/transaction/transactional-entity-manager';
import type { Repository } from 'typeorm';

interface RatingAggregateRow {
  avg: string | number | null;
  count: string | number;
}

@Injectable()
export class TypeOrmReviewRepository implements ReviewRepository {
  constructor(
    @InjectRepository(ReviewOrmEntity)
    private readonly ormRepository: Repository<ReviewOrmEntity>,
  ) {}

  private get repository(): Repository<ReviewOrmEntity> {
    return getTransactionalEntityManager()?.getRepository(ReviewOrmEntity) ?? this.ormRepository;
  }

  /** Raw insert — a duplicate `order_id` throws the driver's unique-violation, translated by the caller. */
  async save(review: Review): Promise<Review> {
    await this.repository.insert({
      id: review.id,
      tenantId: review.tenantId,
      orderId: review.orderId,
      restaurantId: review.restaurantId,
      userId: review.userId,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
    });
    return review;
  }

  /**
   * Recomputes from the `reviews` table (not an incremental counter) so the
   * aggregate is always correct regardless of how many times a submit is
   * retried. Runs on the SAME (possibly transactional) manager as `save`, so
   * it sees a review just inserted in this transaction.
   */
  async aggregateForRestaurant(
    tenantId: string,
    restaurantId: string,
  ): Promise<RestaurantRatingAggregate> {
    const manager = getTransactionalEntityManager() ?? this.ormRepository.manager;
    const rows = await manager.query<RatingAggregateRow[]>(
      'SELECT AVG(rating) AS avg, COUNT(*) AS count FROM "reviews" WHERE restaurant_id = $1 AND tenant_id = $2',
      [restaurantId, tenantId],
    );
    const avg = Number(rows[0]?.avg ?? 0);
    const count = Number(rows[0]?.count ?? 0);
    return { avgRating: Math.round(avg * 100) / 100, reviewCount: count };
  }
}
