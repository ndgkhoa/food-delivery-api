import {
  IdempotentConsumer,
  PROCESSED_EVENT_STORE,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import { Inject, Injectable } from '@nestjs/common';
import type { EligibleOrderInput } from '@review/application/parse-eligible-order';
import {
  REVIEW_ELIGIBLE_ORDER_REPOSITORY,
  type ReviewEligibleOrderRepository,
} from '@review/domain/eligibility/review-eligible-order.repository';
import { TRANSACTION_PORT, type TransactionPort } from '@review/domain/shared/transaction.port';

@Injectable()
export class RecordReviewEligibilityHandler {
  constructor(
    @Inject(REVIEW_ELIGIBLE_ORDER_REPOSITORY)
    private readonly eligibility: ReviewEligibleOrderRepository,
    @Inject(PROCESSED_EVENT_STORE) private readonly processedEvents: ProcessedEventStorePort,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
  ) {}

  async execute(eventId: string, tenantId: string, order: EligibleOrderInput): Promise<void> {
    await this.transaction.runInTransaction(() =>
      IdempotentConsumer.runOnce(this.processedEvents, eventId, undefined, () =>
        this.eligibility.upsertEligible({ ...order, tenantId }),
      ),
    );
  }
}
