import { CreateRestaurantHandler } from '@catalog/application/restaurant/commands/create-restaurant.handler';
import { DeleteRestaurantHandler } from '@catalog/application/restaurant/commands/delete-restaurant.handler';
import { UpdateRestaurantHandler } from '@catalog/application/restaurant/commands/update-restaurant.handler';
import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import { ListRestaurantsHandler } from '@catalog/application/restaurant/queries/list-restaurants.handler';
import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { MenuItemRepository } from '@catalog/domain/menu-item/menu-item.repository';
import type {
  ReadRestaurantRepository,
  ReadRestaurantRow,
} from '@catalog/domain/read-model/read-restaurant.repository';
import { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { RestaurantRepository } from '@catalog/domain/restaurant/restaurant.repository';
import type { AuditEntry, AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import type { OutboxEntry, OutboxWriter } from '@catalog/domain/shared/outbox.port';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';
import type { TransactionPort } from '@catalog/domain/shared/transaction.port';
import { FakeRedisCache } from '@catalog/testing/fake-redis-cache';
import type { TenantContextPort, TenantRequestContext } from '@food-delivery-api/shared-tenancy';

/**
 * In-memory fake — no DB. Backs both the write port and the read-model port off
 * one map, so a `save` in a command is visible to the list handler (which reads
 * the read model), letting these tests exercise the whole slice without a
 * projection loop.
 */
class FakeRestaurantRepository implements RestaurantRepository, ReadRestaurantRepository {
  private readonly rows = new Map<string, Restaurant>();

  async save(restaurant: Restaurant): Promise<Restaurant> {
    this.rows.set(restaurant.id, restaurant);
    return restaurant;
  }

  async findById(id: string, tenantId: string): Promise<Restaurant | null> {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId && !row.deletedAt ? row : null;
  }

  async findAndCount(tenantId: string, pagination: Pagination): Promise<PageResult<Restaurant>> {
    const all = [...this.rows.values()].filter((r) => r.tenantId === tenantId && !r.deletedAt);
    const start = (pagination.page - 1) * pagination.limit;
    return { data: all.slice(start, start + pagination.limit), total: all.length };
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    const row = this.rows.get(id);
    // Simulates soft-delete by removing from the visible set (mirrors TypeORM's
    // default find/findOne excluding rows with deletedAt set).
    if (row && row.tenantId === tenantId) {
      this.rows.delete(id);
    }
  }

  async upsert(row: ReadRestaurantRow): Promise<void> {
    this.rows.set(row.id, Restaurant.reconstitute({ ...row, deletedAt: null }));
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const row = this.rows.get(id);
    if (row && row.tenantId === tenantId) {
      this.rows.delete(id);
    }
  }

  async updateRating(): Promise<void> {}
}

/** Records emitted outbox entries so tests can assert an event was appended per write. */
class FakeOutboxWriter implements OutboxWriter {
  readonly entries: OutboxEntry[] = [];

  async write(entry: OutboxEntry): Promise<void> {
    this.entries.push(entry);
  }
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

class FakeAuditPort implements AuditPort {
  readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

/** Runs the work directly — the in-memory fakes need no real commit/rollback boundary. */
class FakeTransactionPort implements TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

/** Minimal stub so `DeleteRestaurantHandler` can cascade; records the cascade target for assertions. */
class FakeMenuItemRepository implements Partial<MenuItemRepository> {
  readonly cascadedRestaurantIds: string[] = [];
  /** Live items per restaurant the delete handler enumerates to emit per-item delete events. */
  readonly itemsByRestaurant = new Map<string, MenuItem[]>();

  async findAllByRestaurant(restaurantId: string): Promise<MenuItem[]> {
    return this.itemsByRestaurant.get(restaurantId) ?? [];
  }

  async softDeleteByRestaurant(restaurantId: string): Promise<void> {
    this.cascadedRestaurantIds.push(restaurantId);
  }
}

/** Bare MenuItem stand-in — the delete path only needs its id + snapshot for the outbox entry. */
function fakeMenuItem(id: string): MenuItem {
  return { id, toSnapshot: () => ({ id }) } as unknown as MenuItem;
}

describe('restaurant application handlers', () => {
  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';

  let repository: FakeRestaurantRepository;
  let menuItemRepository: FakeMenuItemRepository;
  let tenantContext: FakeTenantContext;
  let auditPort: FakeAuditPort;
  let outboxWriter: FakeOutboxWriter;
  let transaction: FakeTransactionPort;
  let getRestaurant: GetRestaurantHandler;
  let createRestaurant: CreateRestaurantHandler;
  let updateRestaurant: UpdateRestaurantHandler;
  let deleteRestaurant: DeleteRestaurantHandler;
  let listRestaurants: ListRestaurantsHandler;

  beforeEach(() => {
    repository = new FakeRestaurantRepository();
    menuItemRepository = new FakeMenuItemRepository();
    tenantContext = new FakeTenantContext({ tenantId: tenantA, actor: 'test-suite', roles: [] });
    auditPort = new FakeAuditPort();
    outboxWriter = new FakeOutboxWriter();
    transaction = new FakeTransactionPort();
    getRestaurant = new GetRestaurantHandler(repository, tenantContext);
    createRestaurant = new CreateRestaurantHandler(
      repository,
      tenantContext,
      auditPort,
      outboxWriter,
      transaction,
    );
    updateRestaurant = new UpdateRestaurantHandler(
      repository,
      auditPort,
      outboxWriter,
      transaction,
      getRestaurant,
    );
    deleteRestaurant = new DeleteRestaurantHandler(
      repository,
      menuItemRepository as unknown as MenuItemRepository,
      auditPort,
      outboxWriter,
      transaction,
      getRestaurant,
    );
    listRestaurants = new ListRestaurantsHandler(
      repository,
      tenantContext,
      new FakeRedisCache().asRedisCache(),
    );
  });

  it('creates a restaurant scoped to the calling tenant and writes an audit entry', async () => {
    const restaurant = await createRestaurant.execute({ name: 'Pho House' });

    expect(restaurant.id).toBeDefined();
    expect(restaurant.tenantId).toBe(tenantA);
    expect(auditPort.entries).toHaveLength(1);
    expect(auditPort.entries[0]).toMatchObject({
      action: AuditAction.CREATE,
      entity: 'restaurant',
      entityId: restaurant.id,
    });
    // A RestaurantCreated event is appended to the outbox in the same commit.
    expect(outboxWriter.entries).toHaveLength(1);
    expect(outboxWriter.entries[0]).toMatchObject({
      aggregateType: 'catalog',
      aggregateId: restaurant.id,
      type: 'RestaurantCreated',
    });
  });

  it('excludes soft-deleted restaurants from findAll and get', async () => {
    const restaurant = await createRestaurant.execute({ name: 'Banh Mi Corner' });
    menuItemRepository.itemsByRestaurant.set(restaurant.id, [
      fakeMenuItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      fakeMenuItem('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    ]);
    await deleteRestaurant.execute(restaurant.id);

    const list = await listRestaurants.execute({ page: 1, limit: 20 });
    expect(list.data.find((r) => r.id === restaurant.id)).toBeUndefined();

    await expect(getRestaurant.execute(restaurant.id)).rejects.toThrow(/not found/i);

    const deleteEntry = auditPort.entries.find((e) => e.action === AuditAction.DELETE);
    expect(deleteEntry).toBeDefined();

    // Deleting a restaurant cascades a soft-delete to its menu items.
    expect(menuItemRepository.cascadedRestaurantIds).toContain(restaurant.id);

    // It also emits RestaurantDeleted + one MenuItemDeleted per live item, so
    // each item's own partition carries a terminal event (no orphan read rows).
    expect(outboxWriter.entries.filter((e) => e.type === 'RestaurantDeleted')).toHaveLength(1);
    const itemDeletes = outboxWriter.entries.filter((e) => e.type === 'MenuItemDeleted');
    expect(itemDeletes.map((e) => e.aggregateId).sort()).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
  });

  it("does not allow one tenant to read another tenant's restaurant", async () => {
    const restaurant = await createRestaurant.execute({ name: 'Tenant A Only' });

    tenantContext.run({ tenantId: tenantB, actor: 'test-suite', roles: [] }, () => {});
    await expect(getRestaurant.execute(restaurant.id)).rejects.toThrow(/not found/i);

    const listForB = await listRestaurants.execute({ page: 1, limit: 20 });
    expect(listForB.data).toHaveLength(0);
  });

  it('records a before/after snapshot on update', async () => {
    const restaurant = await createRestaurant.execute({ name: 'Original Name' });
    const updated = await updateRestaurant.execute(restaurant.id, { name: 'Updated Name' });

    expect(updated.name).toBe('Updated Name');

    const updateEntry = auditPort.entries.find((e) => e.action === AuditAction.UPDATE);
    expect(updateEntry?.before).toMatchObject({ name: 'Original Name' });
    expect(updateEntry?.after).toMatchObject({ name: 'Updated Name' });
  });
});
