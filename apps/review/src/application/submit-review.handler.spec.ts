import { SubmitReviewHandler } from '@review/application/submit-review.handler';
import type {
  EligibleOrderRow,
  ReviewEligibleOrderRepository,
} from '@review/domain/eligibility/review-eligible-order.repository';
import type { Review } from '@review/domain/review/review';
import type {
  RestaurantRatingAggregate,
  ReviewRepository,
} from '@review/domain/review/review.repository';
import {
  DuplicateReviewError,
  InvalidRatingError,
  ReviewEligibilityNotFoundError,
  ReviewNotOwnedError,
} from '@review/domain/shared/errors';
import type { OutboxCommandEntry, OutboxWriter } from '@review/domain/shared/outbox.port';
import type { TransactionPort } from '@review/domain/shared/transaction.port';

class FakeEligibleOrderRepository implements ReviewEligibleOrderRepository {
  private readonly rows = new Map<string, EligibleOrderRow>();

  seed(row: EligibleOrderRow): void {
    this.rows.set(row.orderId, row);
  }

  async upsertEligible(row: EligibleOrderRow): Promise<void> {
    this.rows.set(row.orderId, row);
  }

  async findEligible(tenantId: string, orderId: string): Promise<EligibleOrderRow | null> {
    const row = this.rows.get(orderId);
    return row && row.tenantId === tenantId ? row : null;
  }
}

class UniqueViolationError extends Error {
  code = '23505';
}

class FakeReviewRepository implements ReviewRepository {
  readonly saved: Review[] = [];
  private readonly seenOrderIds = new Set<string>();
  forceDuplicateOn: string | null = null;

  async save(review: Review): Promise<Review> {
    if (this.forceDuplicateOn === review.orderId || this.seenOrderIds.has(review.orderId)) {
      throw new UniqueViolationError('duplicate order_id');
    }
    this.seenOrderIds.add(review.orderId);
    this.saved.push(review);
    return review;
  }

  async aggregateForRestaurant(
    _tenantId: string,
    restaurantId: string,
  ): Promise<RestaurantRatingAggregate> {
    const ratings = this.saved.filter((r) => r.restaurantId === restaurantId).map((r) => r.rating);
    const avg = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
    return { avgRating: Math.round(avg * 100) / 100, reviewCount: ratings.length };
  }
}

class FakeOutboxWriter implements OutboxWriter {
  readonly entries: OutboxCommandEntry[] = [];

  async append(entry: OutboxCommandEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class FakeTransactionPort implements TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const ownerUserId = '33333333-3333-4333-8333-333333333333';
const otherUserId = '44444444-4444-4444-8444-444444444444';

describe('SubmitReviewHandler', () => {
  let eligibility: FakeEligibleOrderRepository;
  let reviews: FakeReviewRepository;
  let outbox: FakeOutboxWriter;
  let handler: SubmitReviewHandler;

  beforeEach(() => {
    eligibility = new FakeEligibleOrderRepository();
    reviews = new FakeReviewRepository();
    outbox = new FakeOutboxWriter();
    handler = new SubmitReviewHandler(eligibility, reviews, outbox, new FakeTransactionPort());
  });

  it('persists the review and emits a RestaurantRatingChanged keyed by restaurant id', async () => {
    eligibility.seed({ orderId: 'order-1', tenantId, userId: ownerUserId, restaurantId });

    const review = await handler.execute({
      tenantId,
      userId: ownerUserId,
      orderId: 'order-1',
      rating: 4,
      comment: '  Great food!  ',
    });

    expect(review.restaurantId).toBe(restaurantId);
    expect(review.comment).toBe('Great food!');
    expect(reviews.saved).toHaveLength(1);

    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]).toMatchObject({
      aggregateId: restaurantId,
      topic: 'review.events',
      eventType: 'RestaurantRatingChanged',
      payload: { restaurantId, avgRating: 4, reviewCount: 1 },
    });
  });

  it('recomputes the average from all reviews (2 decimals) rather than incrementally', async () => {
    eligibility.seed({ orderId: 'order-1', tenantId, userId: ownerUserId, restaurantId });
    eligibility.seed({ orderId: 'order-2', tenantId, userId: otherUserId, restaurantId });

    await handler.execute({ tenantId, userId: ownerUserId, orderId: 'order-1', rating: 5 });
    await handler.execute({ tenantId, userId: otherUserId, orderId: 'order-2', rating: 4 });

    expect(outbox.entries[1].payload).toMatchObject({ avgRating: 4.5, reviewCount: 2 });
  });

  it('rounds a repeating-decimal average to 2 decimals', async () => {
    eligibility.seed({ orderId: 'order-1', tenantId, userId: ownerUserId, restaurantId });
    eligibility.seed({ orderId: 'order-2', tenantId, userId: otherUserId, restaurantId });
    eligibility.seed({ orderId: 'order-3', tenantId, userId: ownerUserId, restaurantId });

    await handler.execute({ tenantId, userId: ownerUserId, orderId: 'order-1', rating: 5 });
    await handler.execute({ tenantId, userId: otherUserId, orderId: 'order-2', rating: 4 });
    await handler.execute({ tenantId, userId: ownerUserId, orderId: 'order-3', rating: 4 });

    expect(outbox.entries[2].payload).toMatchObject({ avgRating: 4.33, reviewCount: 3 });
  });

  it('rejects an order with no eligibility record (never confirmed / does not exist)', async () => {
    await expect(
      handler.execute({ tenantId, userId: ownerUserId, orderId: 'no-such-order', rating: 5 }),
    ).rejects.toThrow(ReviewEligibilityNotFoundError);
    expect(reviews.saved).toHaveLength(0);
  });

  it("rejects a cross-tenant order id as not-found (never leaks the other tenant's order)", async () => {
    eligibility.seed({
      orderId: 'order-1',
      tenantId: otherTenantId,
      userId: ownerUserId,
      restaurantId,
    });

    await expect(
      handler.execute({ tenantId, userId: ownerUserId, orderId: 'order-1', rating: 5 }),
    ).rejects.toThrow(ReviewEligibilityNotFoundError);
  });

  it('rejects a caller who is not the order owner', async () => {
    eligibility.seed({ orderId: 'order-1', tenantId, userId: ownerUserId, restaurantId });

    await expect(
      handler.execute({ tenantId, userId: otherUserId, orderId: 'order-1', rating: 5 }),
    ).rejects.toThrow(ReviewNotOwnedError);
    expect(reviews.saved).toHaveLength(0);
  });

  it('rejects a second review on the same order as a duplicate', async () => {
    eligibility.seed({ orderId: 'order-1', tenantId, userId: ownerUserId, restaurantId });
    await handler.execute({ tenantId, userId: ownerUserId, orderId: 'order-1', rating: 5 });

    await expect(
      handler.execute({ tenantId, userId: ownerUserId, orderId: 'order-1', rating: 3 }),
    ).rejects.toThrow(DuplicateReviewError);
    expect(reviews.saved).toHaveLength(1);
  });

  it('rejects an out-of-range rating before touching the eligibility repository', async () => {
    await expect(
      handler.execute({ tenantId, userId: ownerUserId, orderId: 'order-1', rating: 7 }),
    ).rejects.toThrow(InvalidRatingError);
    expect(reviews.saved).toHaveLength(0);
  });
});
