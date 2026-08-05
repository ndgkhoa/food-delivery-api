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
import { ConcurrencyConflictError } from '@catalog/domain/shared/errors';
import type { OutboxEntry, OutboxWriter } from '@catalog/domain/shared/outbox.port';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';
import type { TransactionPort } from '@catalog/domain/shared/transaction.port';
import { FakeRedisCache } from '@catalog/testing/fake-redis-cache';
import type { TenantContextPort, TenantRequestContext } from '@food-delivery-api/shared-tenancy';

class FakeRestaurantRepository implements RestaurantRepository, ReadRestaurantRepository {
  private readonly rows = new Map<string, Restaurant>();

  async save(restaurant: Restaurant): Promise<Restaurant> {
    this.rows.set(restaurant.id, restaurant);
    return restaurant;
  }

  async updateVersioned(restaurant: Restaurant): Promise<Restaurant> {
    const current = this.rows.get(restaurant.id);
    if (!current || current.version !== restaurant.version) {
      throw new ConcurrencyConflictError('Restaurant', restaurant.id);
    }
    const saved = Restaurant.reconstitute({
      id: restaurant.id,
      tenantId: restaurant.tenantId,
      name: restaurant.name,
      description: restaurant.description,
      isActive: restaurant.isActive,
      createdAt: restaurant.createdAt,
      updatedAt: restaurant.updatedAt,
      deletedAt: restaurant.deletedAt,
      version: restaurant.version + 1,
    });
    this.rows.set(restaurant.id, saved);
    return saved;
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

class FakeTransactionPort implements TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

class FakeMenuItemRepository implements Partial<MenuItemRepository> {
  readonly cascadedRestaurantIds: string[] = [];
  readonly itemsByRestaurant = new Map<string, MenuItem[]>();

  async findAllByRestaurant(restaurantId: string): Promise<MenuItem[]> {
    return this.itemsByRestaurant.get(restaurantId) ?? [];
  }

  async softDeleteByRestaurant(restaurantId: string): Promise<void> {
    this.cascadedRestaurantIds.push(restaurantId);
  }
}

function fakeMenuItem(id: string): MenuItem {
  return { id, toSnapshot: () => ({ id }) } as unknown as MenuItem;
}

describe('RestaurantHandlers', () => {
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

    expect(menuItemRepository.cascadedRestaurantIds).toContain(restaurant.id);

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

  it('increments the version and returns it on a normal update', async () => {
    const restaurant = await createRestaurant.execute({ name: 'Original Name' });
    expect(restaurant.version).toBe(1);

    const updated = await updateRestaurant.execute(restaurant.id, { name: 'Updated Name' });
    expect(updated.version).toBe(2);
  });

  it('rejects a PATCH carrying a stale If-Match version before writing or auditing', async () => {
    const restaurant = await createRestaurant.execute({ name: 'Original Name' });

    await expect(
      updateRestaurant.execute(restaurant.id, { name: 'Updated Name', expectedVersion: 999 }),
    ).rejects.toThrow(ConcurrencyConflictError);

    const stored = await repository.findById(restaurant.id, tenantA);
    expect(stored?.name).toBe('Original Name');
    expect(auditPort.entries.filter((e) => e.action === AuditAction.UPDATE)).toHaveLength(0);
  });

  it('accepts a PATCH whose If-Match matches the loaded version', async () => {
    const restaurant = await createRestaurant.execute({ name: 'Original Name' });

    const updated = await updateRestaurant.execute(restaurant.id, {
      name: 'Updated Name',
      expectedVersion: restaurant.version,
    });
    expect(updated.name).toBe('Updated Name');
    expect(updated.version).toBe(2);
  });

  it('resolves a concurrent double-write race with exactly one winner, no lost update', async () => {
    const restaurant = await createRestaurant.execute({ name: 'Original Name' });

    const firstView = await getRestaurant.execute(restaurant.id);
    const secondView = await getRestaurant.execute(restaurant.id);
    expect(firstView.version).toBe(secondView.version);

    const firstUpdated = firstView.update({ name: 'Winner' });
    const secondUpdated = secondView.update({ name: 'Loser' });

    const winner = await repository.updateVersioned(firstUpdated);
    expect(winner.name).toBe('Winner');
    expect(winner.version).toBe(firstView.version + 1);

    await expect(repository.updateVersioned(secondUpdated)).rejects.toThrow(
      ConcurrencyConflictError,
    );

    const stored = await repository.findById(restaurant.id, tenantA);
    expect(stored?.name).toBe('Winner');
    expect(stored?.version).toBe(2);
  });
});
