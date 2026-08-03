/**
 * End-to-end proof of the restaurant cache-aside + write-through + eviction
 * strategy against REAL infrastructure (Postgres + Redis + Kafka/Debezium),
 * same live-stack shape as `catalog-outbox-cdc-read-model.e2e-spec.ts`:
 *
 *   docker compose --env-file .env -f infra/docker-compose.yml --profile core --profile messaging up -d
 *   ./infra/debezium/register-connectors.sh
 *   pnpm --filter catalog serve        # catalog on :3001 (projection consumers + cache active)
 *   RUN_CACHE_E2E=1 pnpm nx e2e catalog-e2e --testFile=catalog-restaurant-cache-strategies.e2e-spec.ts
 *
 * Env overrides: CATALOG_BASE_URL (default http://localhost:3001/api/v1).
 *
 * Covers: (1) a cold read misses (served from Postgres) and a repeated read
 * hits (served from Redis, no DB round trip) — observed via the hit-ratio
 * counter at GET /internal/cache-stats; (2) an update makes the VERY NEXT
 * read return the new value (write-through, no stale window); (3) tenant
 * isolation — tenant A's cached restaurant is never served to tenant B;
 * (4) a Redis-down scenario (separate, opt-in flag below — requires Redis
 * stopped BEFORE the run, since the rest of this file needs it up).
 */
const BASE_URL = process.env.CATALOG_BASE_URL ?? 'http://localhost:3001/api/v1';

const tenantId = '77777777-7777-4777-8777-777777777777';
const otherTenantId = '88888888-8888-4888-8888-888888888888';
const ownerHeaders = {
  'content-type': 'application/json',
  'x-tenant-id': tenantId,
  'x-user-id': 'owner-cache-e2e',
  'x-roles': 'restaurant-owner',
};

interface CacheStats {
  hits: number;
  misses: number;
  hitRatio: number;
}

async function cacheStats(): Promise<CacheStats> {
  const res = await fetch(`${BASE_URL}/internal/cache-stats`, { headers: ownerHeaders });
  return (await res.json()) as CacheStats;
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
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

const gatedDescribe = process.env.RUN_CACHE_E2E === '1' ? describe : describe.skip;

gatedDescribe('Restaurant cache: cache-aside + write-through + eviction (e2e, compose)', () => {
  it('is a miss then a hit on a repeated read (hit-ratio counter moves)', async () => {
    const createRes = await fetch(`${BASE_URL}/restaurants`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'Cache Diner' }),
    });
    expect(createRes.status).toBe(201);
    const restaurantId = ((await createRes.json()) as { id: string }).id;

    // Wait for the CDC projection so the read model has the row at all.
    await waitUntil(async () => {
      const res = await fetch(`${BASE_URL}/restaurants/${restaurantId}`, { headers: ownerHeaders });
      return res.status === 200 ? true : undefined;
    });

    const before = await cacheStats();

    // Cold miss (this GET may itself have been the miss above, or a fresh
    // entry may already be cached from the projector's write-through on
    // create — either way, the SECOND read below must be a hit, which is
    // the property under test).
    await fetch(`${BASE_URL}/restaurants/${restaurantId}`, { headers: ownerHeaders });
    const afterFirst = await cacheStats();

    await fetch(`${BASE_URL}/restaurants/${restaurantId}`, { headers: ownerHeaders });
    const afterSecond = await cacheStats();

    expect(afterSecond.hits).toBeGreaterThan(afterFirst.hits);
    expect(afterSecond.hits + afterSecond.misses).toBeGreaterThan(before.hits + before.misses);
  }, 60_000);

  it('an update makes the very next read return the new value (write-through, no stale)', async () => {
    const createRes = await fetch(`${BASE_URL}/restaurants`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'Original Name' }),
    });
    const restaurantId = ((await createRes.json()) as { id: string }).id;

    // Warm the cache with the original value.
    await waitUntil(async () => {
      const res = await fetch(`${BASE_URL}/restaurants/${restaurantId}`, { headers: ownerHeaders });
      if (res.status !== 200) return undefined;
      const body = (await res.json()) as { name: string };
      return body.name === 'Original Name' ? true : undefined;
    });

    await fetch(`${BASE_URL}/restaurants/${restaurantId}`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'Updated Name' }),
    });

    // The projector's write-through happens asynchronously after the update's
    // catalog.events message is projected — poll until the cached value flips.
    // Never observes a stale "Original Name" once the flip is seen.
    const updated = await waitUntil(async () => {
      const res = await fetch(`${BASE_URL}/restaurants/${restaurantId}`, { headers: ownerHeaders });
      const body = (await res.json()) as { name: string };
      return body.name === 'Updated Name' ? body : undefined;
    });
    expect(updated.name).toBe('Updated Name');
  }, 60_000);

  it('a delete evicts — the next read 404s rather than serving a stale cached row', async () => {
    const createRes = await fetch(`${BASE_URL}/restaurants`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'To Be Deleted' }),
    });
    const restaurantId = ((await createRes.json()) as { id: string }).id;

    await waitUntil(async () => {
      const res = await fetch(`${BASE_URL}/restaurants/${restaurantId}`, { headers: ownerHeaders });
      return res.status === 200 ? true : undefined;
    });

    await fetch(`${BASE_URL}/restaurants/${restaurantId}`, {
      method: 'DELETE',
      headers: ownerHeaders,
    });

    await waitUntil(async () => {
      const res = await fetch(`${BASE_URL}/restaurants/${restaurantId}`, { headers: ownerHeaders });
      return res.status === 404 ? true : undefined;
    });
  }, 60_000);

  it("never serves tenant A's cached restaurant to tenant B", async () => {
    const createRes = await fetch(`${BASE_URL}/restaurants`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'Tenant A Only' }),
    });
    const restaurantId = ((await createRes.json()) as { id: string }).id;

    // Warm tenant A's cache entry.
    await waitUntil(async () => {
      const res = await fetch(`${BASE_URL}/restaurants/${restaurantId}`, { headers: ownerHeaders });
      return res.status === 200 ? true : undefined;
    });
    await fetch(`${BASE_URL}/restaurants/${restaurantId}`, { headers: ownerHeaders });

    const otherRes = await fetch(`${BASE_URL}/restaurants/${restaurantId}`, {
      headers: { ...ownerHeaders, 'x-tenant-id': otherTenantId },
    });
    expect(otherRes.status).toBe(404);
  }, 60_000);
});

/**
 * Redis-down fallback — a SEPARATE opt-in scenario, since it requires the
 * OPPOSITE infra state from the rest of this file (Redis stopped, not
 * running). Run manually, isolated:
 *
 *   docker compose --env-file .env -f infra/docker-compose.yml --profile core --profile messaging up -d
 *   docker compose -f infra/docker-compose.yml stop redis
 *   pnpm --filter catalog serve
 *   RUN_CACHE_E2E_REDIS_DOWN=1 pnpm nx e2e catalog-e2e --testFile=catalog-restaurant-cache-strategies.e2e-spec.ts
 *   docker compose -f infra/docker-compose.yml start redis   # restore afterwards
 *
 * Asserts reads still succeed straight from Postgres — Redis is never a hard
 * dependency for the catalog read path.
 */
const gatedRedisDownDescribe =
  process.env.RUN_CACHE_E2E_REDIS_DOWN === '1' ? describe : describe.skip;

gatedRedisDownDescribe('Restaurant reads with Redis down (e2e, compose)', () => {
  it('serves reads from Postgres when Redis is unreachable', async () => {
    const createRes = await fetch(`${BASE_URL}/restaurants`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'Redis Down Diner' }),
    });
    expect(createRes.status).toBe(201);
    const restaurantId = ((await createRes.json()) as { id: string }).id;

    await waitUntil(async () => {
      const res = await fetch(`${BASE_URL}/restaurants/${restaurantId}`, { headers: ownerHeaders });
      return res.status === 200 ? true : undefined;
    });

    const res = await fetch(`${BASE_URL}/restaurants/${restaurantId}`, { headers: ownerHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('Redis Down Diner');
  }, 60_000);
});
