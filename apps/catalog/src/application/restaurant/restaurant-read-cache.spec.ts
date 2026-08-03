import { GetRestaurantViewHandler } from '@catalog/application/restaurant/queries/get-restaurant-view.handler';
import { ListRestaurantsHandler } from '@catalog/application/restaurant/queries/list-restaurants.handler';
import type {
  ReadRestaurantRepository,
  ReadRestaurantRow,
} from '@catalog/domain/read-model/read-restaurant.repository';
import { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';
import { FakeRedisCache } from '@catalog/testing/fake-redis-cache';
import type { TenantContextPort, TenantRequestContext } from '@food-delivery-api/shared-tenancy';

/** Records call counts so a test can assert a cache hit never reaches the repository. */
class SpyReadRestaurantRepository implements ReadRestaurantRepository {
  findByIdCalls = 0;
  findAndCountCalls = 0;
  private readonly rows = new Map<string, Restaurant>();

  seed(row: Restaurant): void {
    this.rows.set(row.id, row);
  }

  async findById(id: string, tenantId: string): Promise<Restaurant | null> {
    this.findByIdCalls += 1;
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async findAndCount(tenantId: string, pagination: Pagination): Promise<PageResult<Restaurant>> {
    this.findAndCountCalls += 1;
    const all = [...this.rows.values()].filter((r) => r.tenantId === tenantId);
    const start = (pagination.page - 1) * pagination.limit;
    return { data: all.slice(start, start + pagination.limit), total: all.length };
  }

  async upsert(_row: ReadRestaurantRow): Promise<void> {}
  async remove(): Promise<void> {}
  async updateRating(): Promise<void> {}
}

class FakeTenantContext implements TenantContextPort {
  constructor(private context: TenantRequestContext) {}
  run<T>(context: TenantRequestContext, callback: () => T): T {
    this.context = context;
    return callback();
  }
  getContext(): TenantRequestContext | undefined {
    return this.context;
  }
  getTenantIdOrThrow(): string {
    return this.context.tenantId;
  }
  getActor(): string {
    return this.context.actor;
  }
}

function restaurant(id: string, tenantId: string, name: string, version = 1): Restaurant {
  const now = new Date('2026-07-01T00:00:00.000Z');
  return Restaurant.reconstitute({
    id,
    tenantId,
    name,
    description: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    rating: 4.5,
    reviewCount: 10,
    version,
  });
}

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const restaurantId = '33333333-3333-4333-8333-333333333333';

describe('restaurant read cache-aside', () => {
  let repository: SpyReadRestaurantRepository;
  let cache: FakeRedisCache;

  beforeEach(() => {
    repository = new SpyReadRestaurantRepository();
    cache = new FakeRedisCache();
  });

  describe('GetRestaurantViewHandler', () => {
    it('a repeated read is served from the cache — the repository is called only once', async () => {
      repository.seed(restaurant(restaurantId, tenantA, 'Pho 24'));
      const tenantContext = new FakeTenantContext({ tenantId: tenantA, actor: 'test', roles: [] });
      const handler = new GetRestaurantViewHandler(repository, tenantContext, cache.asRedisCache());

      const first = await handler.execute(restaurantId);
      const second = await handler.execute(restaurantId);

      expect(first.name).toBe('Pho 24');
      expect(second.name).toBe('Pho 24');
      expect(repository.findByIdCalls).toBe(1);
      expect(cache.hits).toBe(1);
      expect(cache.misses).toBe(1);
    });

    it('returns the real projected version — not the constant `?? 1` domain default', async () => {
      repository.seed(restaurant(restaurantId, tenantA, 'Pho 24', 5));
      const tenantContext = new FakeTenantContext({ tenantId: tenantA, actor: 'test', roles: [] });
      const handler = new GetRestaurantViewHandler(repository, tenantContext, cache.asRedisCache());

      const miss = await handler.execute(restaurantId);
      const hit = await handler.execute(restaurantId);

      expect(miss.version).toBe(5);
      expect(hit.version).toBe(5);
    });

    it("never serves tenant A's cached restaurant to tenant B", async () => {
      repository.seed(restaurant(restaurantId, tenantA, 'Tenant A Only'));
      const contextA = new FakeTenantContext({ tenantId: tenantA, actor: 'a', roles: [] });
      const contextB = new FakeTenantContext({ tenantId: tenantB, actor: 'b', roles: [] });
      const handlerA = new GetRestaurantViewHandler(repository, contextA, cache.asRedisCache());
      const handlerB = new GetRestaurantViewHandler(repository, contextB, cache.asRedisCache());

      await handlerA.execute(restaurantId);
      await expect(handlerB.execute(restaurantId)).rejects.toThrow(/not found/i);

      // Both tenants queried independently — tenant B's miss never resolved from tenant A's entry.
      expect(repository.findByIdCalls).toBe(2);
    });
  });

  describe('ListRestaurantsHandler', () => {
    it('a repeated list with the same pagination is served from the cache', async () => {
      repository.seed(restaurant(restaurantId, tenantA, 'Pho 24'));
      const tenantContext = new FakeTenantContext({ tenantId: tenantA, actor: 'test', roles: [] });
      const handler = new ListRestaurantsHandler(repository, tenantContext, cache.asRedisCache());

      await handler.execute({ page: 1, limit: 20 });
      const second = await handler.execute({ page: 1, limit: 20 });

      expect(second.data).toHaveLength(1);
      expect(repository.findAndCountCalls).toBe(1);
    });

    it('a different pagination is a separate cache key (its own miss)', async () => {
      repository.seed(restaurant(restaurantId, tenantA, 'Pho 24'));
      const tenantContext = new FakeTenantContext({ tenantId: tenantA, actor: 'test', roles: [] });
      const handler = new ListRestaurantsHandler(repository, tenantContext, cache.asRedisCache());

      await handler.execute({ page: 1, limit: 20 });
      await handler.execute({ page: 2, limit: 20 });

      expect(repository.findAndCountCalls).toBe(2);
    });

    it('a listed restaurant carries the real projected version — not the constant `?? 1` domain default', async () => {
      repository.seed(restaurant(restaurantId, tenantA, 'Pho 24', 8));
      const tenantContext = new FakeTenantContext({ tenantId: tenantA, actor: 'test', roles: [] });
      const handler = new ListRestaurantsHandler(repository, tenantContext, cache.asRedisCache());

      const miss = await handler.execute({ page: 1, limit: 20 });
      const hit = await handler.execute({ page: 1, limit: 20 });

      expect(miss.data[0]?.version).toBe(8);
      expect(hit.data[0]?.version).toBe(8);
    });
  });
});
