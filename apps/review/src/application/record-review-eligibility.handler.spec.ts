import {
  DuplicateEventError,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import { RecordReviewEligibilityHandler } from '@review/application/record-review-eligibility.handler';
import type {
  EligibleOrderRow,
  ReviewEligibleOrderRepository,
} from '@review/domain/eligibility/review-eligible-order.repository';
import type { TransactionPort } from '@review/domain/shared/transaction.port';

class FakeEligibleOrderRepository implements ReviewEligibleOrderRepository {
  readonly upserts: EligibleOrderRow[] = [];

  async upsertEligible(row: EligibleOrderRow): Promise<void> {
    this.upserts.push(row);
  }

  async findEligible(): Promise<EligibleOrderRow | null> {
    return null;
  }
}

class FakeProcessedEventStore implements ProcessedEventStorePort {
  private readonly seen = new Set<string>();

  async markProcessed(_tx: unknown, eventId: string): Promise<void> {
    if (this.seen.has(eventId)) {
      throw new DuplicateEventError(eventId);
    }
    this.seen.add(eventId);
  }
}

class FakeTransactionPort implements TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('RecordReviewEligibilityHandler', () => {
  let eligibility: FakeEligibleOrderRepository;
  let processedEvents: FakeProcessedEventStore;
  let handler: RecordReviewEligibilityHandler;

  beforeEach(() => {
    eligibility = new FakeEligibleOrderRepository();
    processedEvents = new FakeProcessedEventStore();
    handler = new RecordReviewEligibilityHandler(
      eligibility,
      processedEvents,
      new FakeTransactionPort(),
    );
  });

  it('records the eligible order', async () => {
    await handler.execute('evt-1', tenantId, {
      orderId: 'order-1',
      userId: 'user-1',
      restaurantId: 'restaurant-1',
    });

    expect(eligibility.upserts).toEqual([
      { orderId: 'order-1', userId: 'user-1', restaurantId: 'restaurant-1', tenantId },
    ]);
  });

  it('is idempotent by event id — a redelivered event upserts once', async () => {
    const order = { orderId: 'order-1', userId: 'user-1', restaurantId: 'restaurant-1' };

    await handler.execute('evt-1', tenantId, order);
    await handler.execute('evt-1', tenantId, order);

    expect(eligibility.upserts).toHaveLength(1);
  });
});
