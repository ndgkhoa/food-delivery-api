import { randomUUID } from 'node:crypto';
import { produceOrderConfirmed } from './support/order-confirmed-event-support';
import { findReviewByOrderId, waitForEligibility } from './support/review-db-support';
import { collectRatingChangedEvents } from './support/review-events-support';

const gatedDescribe = process.env.RUN_REVIEW_E2E === '1' ? describe : describe.skip;

const REVIEW_BASE_URL = process.env.REVIEW_BASE_URL ?? 'http://localhost:3009/api/v1';
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function headersFor(userId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-tenant-id': TENANT,
    'x-user-id': userId,
    'x-roles': 'customer',
  };
}

async function submitReview(
  userId: string,
  orderId: string,
  rating: number,
  comment?: string,
): Promise<Response> {
  return fetch(`${REVIEW_BASE_URL}/reviews`, {
    method: 'POST',
    headers: headersFor(userId),
    body: JSON.stringify({ orderId, rating, comment }),
  });
}

gatedDescribe('review submit + rating propagation (e2e)', () => {
  it('submits a review, persists it, and emits a RestaurantRatingChanged keyed by restaurant', async () => {
    const orderId = randomUUID();
    const userId = randomUUID();
    const restaurantId = randomUUID();

    await produceOrderConfirmed({ orderId, userId, restaurantId, tenantId: TENANT });
    await waitForEligibility(orderId);

    const res = await submitReview(userId, orderId, 5, 'Excellent!');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; restaurantId: string; rating: number };
    expect(body.restaurantId).toBe(restaurantId);
    expect(body.rating).toBe(5);

    const row = await findReviewByOrderId(orderId);
    expect(row).toBeDefined();
    expect(row?.rating).toBe(5);
    expect(row?.comment).toBe('Excellent!');

    const events = await collectRatingChangedEvents(restaurantId, 1);
    expect(events).toEqual([{ avgRating: 5, reviewCount: 1 }]);
  }, 60_000);

  it('rejects a second review on the same order with 409', async () => {
    const orderId = randomUUID();
    const userId = randomUUID();
    const restaurantId = randomUUID();

    await produceOrderConfirmed({ orderId, userId, restaurantId, tenantId: TENANT });
    await waitForEligibility(orderId);

    const first = await submitReview(userId, orderId, 4);
    expect(first.status).toBe(201);

    const second = await submitReview(userId, orderId, 2);
    expect(second.status).toBe(409);
  }, 60_000);

  it('rejects a non-owner attempting to review the order', async () => {
    const orderId = randomUUID();
    const ownerId = randomUUID();
    const impostorId = randomUUID();
    const restaurantId = randomUUID();

    await produceOrderConfirmed({ orderId, userId: ownerId, restaurantId, tenantId: TENANT });
    await waitForEligibility(orderId);

    const res = await submitReview(impostorId, orderId, 5);
    expect(res.status).toBe(403);
  }, 60_000);

  it('rejects a review for an order with no eligibility record', async () => {
    const res = await submitReview(randomUUID(), randomUUID(), 5);
    expect(res.status).toBe(404);
  }, 30_000);
});
