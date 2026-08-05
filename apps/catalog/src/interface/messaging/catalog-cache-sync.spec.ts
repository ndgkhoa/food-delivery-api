import type {
  ReadRestaurantRepository,
  ReadRestaurantRow,
} from '@catalog/domain/read-model/read-restaurant.repository';
import { Restaurant } from '@catalog/domain/restaurant/restaurant';
import { restaurantCacheKey } from '@catalog/domain/shared/cache-keys';
import type { PageResult } from '@catalog/domain/shared/pagination';
import { syncRestaurantCache } from '@catalog/interface/messaging/catalog-cache-sync';
import { FakeRedisCache } from '@catalog/testing/fake-redis-cache';

class FakeReadRestaurantRepository implements ReadRestaurantRepository {
  private readonly rows = new Map<string, Restaurant>();

  seed(row: Restaurant): void {
    this.rows.set(row.id, row);
  }

  async findById(id: string, tenantId: string): Promise<Restaurant | null> {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async findAndCount(): Promise<PageResult<Restaurant>> {
    return { data: [], total: 0 };
  }
  async upsert(_row: ReadRestaurantRow): Promise<void> {}
  async remove(id: string): Promise<void> {
    this.rows.delete(id);
  }
  async updateRating(): Promise<void> {}
}

const tenantId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';

function restaurant(
  overrides: Partial<{ name: string; rating: number; reviewCount: number; version: number }> = {},
): Restaurant {
  const now = new Date('2026-07-01T00:00:00.000Z');
  return Restaurant.reconstitute({
    id: restaurantId,
    tenantId,
    name: overrides.name ?? 'Pho 24',
    description: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    rating: overrides.rating ?? 0,
    reviewCount: overrides.reviewCount ?? 0,
    version: overrides.version ?? 1,
  });
}

describe('syncRestaurantCache', () => {
  let repository: FakeReadRestaurantRepository;
  let cache: FakeRedisCache;
  const key = restaurantCacheKey(tenantId, restaurantId);

  beforeEach(() => {
    repository = new FakeReadRestaurantRepository();
    cache = new FakeRedisCache();
  });

  it('write-throughs the fresh read-model row on RestaurantCreated so the very next read is a hit with the new value', async () => {
    repository.seed(restaurant({ name: 'Pho 24' }));

    await syncRestaurantCache(
      'RestaurantCreated',
      restaurantId,
      tenantId,
      cache.asRedisCache(),
      repository,
    );

    const cached = await cache.cacheAside(key, 1000, async () => {
      throw new Error('should not miss — write-through already warmed the cache');
    });
    expect(cached).toMatchObject({ name: 'Pho 24' });
  });

  it('write-throughs the updated value on RestaurantUpdated — no stale-after-write', async () => {
    repository.seed(restaurant({ name: 'Old Name' }));
    await syncRestaurantCache(
      'RestaurantCreated',
      restaurantId,
      tenantId,
      cache.asRedisCache(),
      repository,
    );

    repository.seed(restaurant({ name: 'New Name' }));
    await syncRestaurantCache(
      'RestaurantUpdated',
      restaurantId,
      tenantId,
      cache.asRedisCache(),
      repository,
    );

    const cached = await cache.cacheAside(key, 1000, async () => {
      throw new Error('should not miss');
    });
    expect(cached).toMatchObject({ name: 'New Name' });
  });

  it('write-throughs the bumped version on RestaurantUpdated — a cache hit reflects the new version, not the pre-update one', async () => {
    repository.seed(restaurant({ version: 1 }));
    await syncRestaurantCache(
      'RestaurantCreated',
      restaurantId,
      tenantId,
      cache.asRedisCache(),
      repository,
    );

    repository.seed(restaurant({ version: 2 }));
    await syncRestaurantCache(
      'RestaurantUpdated',
      restaurantId,
      tenantId,
      cache.asRedisCache(),
      repository,
    );

    const cached = await cache.cacheAside(key, 1000, async () => {
      throw new Error('should not miss — write-through already warmed the cache');
    });
    expect(cached).toMatchObject({ version: 2 });
  });

  it('write-throughs the recomputed rating on RestaurantRatingChanged', async () => {
    repository.seed(restaurant({ rating: 4.8, reviewCount: 42 }));

    await syncRestaurantCache(
      'RestaurantRatingChanged',
      restaurantId,
      tenantId,
      cache.asRedisCache(),
      repository,
    );

    const cached = await cache.cacheAside(key, 1000, async () => {
      throw new Error('should not miss');
    });
    expect(cached).toMatchObject({ rating: 4.8, reviewCount: 42 });
  });

  it('evicts the cache entry on RestaurantDeleted', async () => {
    repository.seed(restaurant());
    await syncRestaurantCache(
      'RestaurantCreated',
      restaurantId,
      tenantId,
      cache.asRedisCache(),
      repository,
    );
    expect(cache.has(key)).toBe(true);

    await syncRestaurantCache(
      'RestaurantDeleted',
      restaurantId,
      tenantId,
      cache.asRedisCache(),
      repository,
    );

    expect(cache.has(key)).toBe(false);
  });

  it('ignores an unrelated event type without touching the cache', async () => {
    await syncRestaurantCache(
      'MenuItemCreated',
      restaurantId,
      tenantId,
      cache.asRedisCache(),
      repository,
    );

    expect(cache.has(key)).toBe(false);
  });

  it('swallows a read-model read error — never re-drives an already-committed projection', async () => {
    const throwingRepo = {
      findById: jest.fn().mockRejectedValue(new Error('read model unavailable')),
    } as unknown as ReadRestaurantRepository;

    await expect(
      syncRestaurantCache(
        'RestaurantUpdated',
        restaurantId,
        tenantId,
        cache.asRedisCache(),
        throwingRepo,
      ),
    ).resolves.toBeUndefined();
  });
});
