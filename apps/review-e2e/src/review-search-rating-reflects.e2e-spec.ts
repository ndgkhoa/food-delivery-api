import { randomUUID } from 'node:crypto';
import { produceOrderConfirmed } from './support/order-confirmed-event-support';
import { waitForEligibility } from './support/review-db-support';

const gatedDescribe = process.env.RUN_REVIEW_SEARCH_E2E === '1' ? describe : describe.skip;

const CATALOG_BASE_URL = process.env.CATALOG_BASE_URL ?? 'http://localhost:3001/api/v1';
const REVIEW_BASE_URL = process.env.REVIEW_BASE_URL ?? 'http://localhost:3009/api/v1';
const SEARCH_BASE_URL = process.env.SEARCH_BASE_URL ?? 'http://localhost:3004/api/v1';
const TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function headersFor(userId: string, roles = 'customer'): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-tenant-id': TENANT,
    'x-user-id': userId,
    'x-roles': roles,
  };
}

interface SearchHit {
  id: string;
  rating: number;
}
interface SearchResponse {
  data: SearchHit[];
}

async function waitUntil<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== undefined) {
      return result;
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the ES rating to update');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

gatedDescribe('review submit → search ES rating field (e2e)', () => {
  it('reflects the recomputed average in the ES rating field within seconds', async () => {
    const suffix = randomUUID().slice(0, 8);

    const ownerId = randomUUID();
    const createRes = await fetch(`${CATALOG_BASE_URL}/restaurants`, {
      method: 'POST',
      headers: headersFor(ownerId, 'restaurant-owner'),
      body: JSON.stringify({ name: `Rated Bistro ${suffix}` }),
    });
    expect(createRes.status).toBe(201);
    const { id: restaurantId } = (await createRes.json()) as { id: string };

    await waitUntil(async () => {
      const res = await fetch(
        `${SEARCH_BASE_URL}/search/restaurants?q=${encodeURIComponent(`Rated Bistro ${suffix}`)}`,
        {
          headers: headersFor(ownerId),
        },
      );
      if (res.status !== 200) {
        return undefined;
      }
      const body = (await res.json()) as SearchResponse;
      return body.data.find((hit) => hit.id === restaurantId) ? true : undefined;
    });

    const orderId = randomUUID();
    const customerId = randomUUID();
    await produceOrderConfirmed({ orderId, userId: customerId, restaurantId, tenantId: TENANT });
    await waitForEligibility(orderId);

    const submitRes = await fetch(`${REVIEW_BASE_URL}/reviews`, {
      method: 'POST',
      headers: headersFor(customerId),
      body: JSON.stringify({ orderId, rating: 5 }),
    });
    expect(submitRes.status).toBe(201);

    const rated = await waitUntil(async () => {
      const res = await fetch(
        `${SEARCH_BASE_URL}/search/restaurants?q=${encodeURIComponent(`Rated Bistro ${suffix}`)}`,
        { headers: headersFor(ownerId) },
      );
      if (res.status !== 200) {
        return undefined;
      }
      const body = (await res.json()) as SearchResponse;
      const hit = body.data.find((h) => h.id === restaurantId);
      return hit && hit.rating === 5 ? hit : undefined;
    });
    expect(rated.rating).toBe(5);

    const renamed = `Rated Bistro ${suffix} Deluxe`;
    const patchRes = await fetch(`${CATALOG_BASE_URL}/restaurants/${restaurantId}`, {
      method: 'PATCH',
      headers: headersFor(ownerId, 'restaurant-owner'),
      body: JSON.stringify({ name: renamed }),
    });
    expect(patchRes.status).toBe(200);

    const afterEdit = await waitUntil(async () => {
      const res = await fetch(
        `${SEARCH_BASE_URL}/search/restaurants?q=${encodeURIComponent(renamed)}`,
        { headers: headersFor(ownerId) },
      );
      if (res.status !== 200) {
        return undefined;
      }
      const body = (await res.json()) as SearchResponse;
      const hit = body.data.find((h) => h.id === restaurantId);
      return hit ? hit : undefined;
    });
    expect(afterEdit.rating).toBe(5);
  }, 120_000);
});
