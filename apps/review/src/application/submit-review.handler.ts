import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { restaurantRatingChangedEvent } from '@review/application/build-rating-changed-event';
import {
  REVIEW_ELIGIBLE_ORDER_REPOSITORY,
  type ReviewEligibleOrderRepository,
} from '@review/domain/eligibility/review-eligible-order.repository';
import { Rating } from '@review/domain/review/rating';
import { Review } from '@review/domain/review/review';
import { REVIEW_REPOSITORY, type ReviewRepository } from '@review/domain/review/review.repository';
import {
  DuplicateReviewError,
  ReviewEligibilityNotFoundError,
  ReviewNotOwnedError,
} from '@review/domain/shared/errors';
import { OUTBOX_WRITER, type OutboxWriter } from '@review/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@review/domain/shared/transaction.port';

export interface SubmitReviewCommand {
  tenantId: string;
  userId: string;
  orderId: string;
  rating: number;
  comment?: string;
}

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  const wrapped = error as { code?: string; driverError?: { code?: string } };
  return (wrapped?.driverError?.code ?? wrapped?.code) === PG_UNIQUE_VIOLATION;
}

@Injectable()
export class SubmitReviewHandler {
  constructor(
    @Inject(REVIEW_ELIGIBLE_ORDER_REPOSITORY)
    private readonly eligibility: ReviewEligibleOrderRepository,
    @Inject(REVIEW_REPOSITORY) private readonly reviewRepository: ReviewRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
  ) {}

  async execute(command: SubmitReviewCommand): Promise<Review> {
    const rating = Rating.create(command.rating);

    const eligible = await this.eligibility.findEligible(command.tenantId, command.orderId);
    if (!eligible) {
      throw new ReviewEligibilityNotFoundError(command.orderId);
    }
    if (eligible.userId !== command.userId) {
      throw new ReviewNotOwnedError(command.orderId);
    }

    const review = Review.create({
      id: randomUUID(),
      tenantId: command.tenantId,
      orderId: command.orderId,
      restaurantId: eligible.restaurantId,
      userId: command.userId,
      rating,
      comment: command.comment,
    });

    try {
      return await this.transaction.runInTransaction(async () => {
        const saved = await this.reviewRepository.save(review);
        const aggregate = await this.reviewRepository.aggregateForRestaurant(
          command.tenantId,
          eligible.restaurantId,
        );
        await this.outbox.append(
          restaurantRatingChangedEvent(
            eligible.restaurantId,
            aggregate.avgRating,
            aggregate.reviewCount,
          ),
        );
        return saved;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateReviewError(command.orderId);
      }
      throw error;
    }
  }
}
