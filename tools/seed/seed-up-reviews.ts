import { REVIEW_COMMENTS } from './demo-data-fixtures';
import { ApiError, describeError, type GatewayClient } from './gateway-api-client';
import { isOrderTerminalStatus, pollOrderStatus } from './order-status-poller';
import type { SeedState } from './seed-state-store';

interface SubmitReviewResponse {
  id: string;
}

const REVIEW_RETRY_ATTEMPTS = 5;
const REVIEW_RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `GET /orders/:id` (order service) until CONFIRMED, CANCELLED, or the attempt budget is spent — the saga confirms asynchronously via Kafka. */
async function waitForConfirmed(customer: GatewayClient, orderId: string): Promise<boolean> {
  const status = await pollOrderStatus(customer, orderId, isOrderTerminalStatus);
  return status === 'CONFIRMED';
}

/**
 * `OrderConfirmed` makes an order review-eligible through a SEPARATE async
 * Kafka consumer (`RecordReviewEligibilityHandler`, driven by
 * `apps/review/src/interface/messaging/order-events.consumer.ts`), so even
 * after `GET /orders/:id` reports CONFIRMED, `POST /reviews` can transiently
 * 404 (`REVIEW_ELIGIBILITY_NOT_FOUND` — `apps/review/src/domain/shared/errors.ts`)
 * until that consumer catches up. Retried with a short delay rather than
 * treated as a hard failure; any other status (e.g. a genuine ownership or
 * validation error) is not retried.
 */
async function submitWithRetry(
  customer: GatewayClient,
  orderId: string,
  rating: number,
  comment: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= REVIEW_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const review = await customer.request<SubmitReviewResponse>(
        `submit review for order ${orderId} (attempt ${attempt})`,
        'POST',
        '/reviews',
        { orderId, rating, comment },
      );
      return review.id;
    } catch (error) {
      lastError = error;
      const notYetEligible = error instanceof ApiError && error.status === 404;
      if (!notYetEligible) throw error;
      if (attempt < REVIEW_RETRY_ATTEMPTS) await sleep(REVIEW_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

/**
 * For each demo order: wait for it to reach CONFIRMED, then submit one
 * review as the order's own customer. An order that never confirms in time,
 * or a review that fails after exhausting retries, is logged as a warning
 * and skipped rather than aborting the whole tenant — reviews are optional
 * demo enrichment, not load-bearing for the rest of the seed run.
 */
export async function submitDemoReviews(
  customer: GatewayClient,
  tenantId: string,
  orderIds: string[],
  state: SeedState,
): Promise<void> {
  console.log(
    `  waiting for ${orderIds.length} order(s) to confirm, then submitting reviews as the customer...`,
  );
  for (const [index, orderId] of orderIds.entries()) {
    const confirmed = await waitForConfirmed(customer, orderId);
    if (!confirmed) {
      console.warn(`  ! order ${orderId} did not reach CONFIRMED in time — skipping review`);
      continue;
    }
    const comment = REVIEW_COMMENTS[index % REVIEW_COMMENTS.length];
    const rating = 4 + (index % 2); // alternates 4/5, never a real user rating
    try {
      const reviewId = await submitWithRetry(customer, orderId, rating, comment);
      state.reviews.push({ id: reviewId, tenantId });
      console.log(`  submitted review ${reviewId} for order ${orderId}`);
    } catch (error) {
      console.warn(`  ! could not submit review for order ${orderId}: ${describeError(error)}`);
    }
  }
}
