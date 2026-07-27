import { CreateMenuItemHandler } from '@catalog/application/menu-item/commands/create-menu-item.handler';
import { DeleteMenuItemHandler } from '@catalog/application/menu-item/commands/delete-menu-item.handler';
import { UpdateMenuItemHandler } from '@catalog/application/menu-item/commands/update-menu-item.handler';
import { GetMenuItemHandler } from '@catalog/application/menu-item/queries/get-menu-item.handler';
import { ListMenuItemsHandler } from '@catalog/application/menu-item/queries/list-menu-items.handler';
import { CreateRestaurantHandler } from '@catalog/application/restaurant/commands/create-restaurant.handler';
import { DeleteRestaurantHandler } from '@catalog/application/restaurant/commands/delete-restaurant.handler';
import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { MenuItemRepository } from '@catalog/domain/menu-item/menu-item.repository';
import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { RestaurantRepository } from '@catalog/domain/restaurant/restaurant.repository';
import type { AuditEntry, AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';
import type {
  TenantContextPort,
  TenantRequestContext,
} from '@catalog/domain/shared/tenant-context.port';
import type { TransactionPort } from '@catalog/domain/shared/transaction.port';

class FakeRestaurantRepository implements RestaurantRepository {
  private readonly rows = new Map<string, Restaurant>();

  async save(restaurant: Restaurant): Promise<Restaurant> {
    this.rows.set(restaurant.id, restaurant);
    return restaurant;
  }

  async findById(id: string, tenantId: string): Promise<Restaurant | null> {
    const row = this.rows.get(id);
    // Mirrors the real adapter: a soft-deleted parent must not resolve.
    return row && row.tenantId === tenantId && !row.deletedAt ? row : null;
  }

  async findAndCount(tenantId: string, _pagination: Pagination): Promise<PageResult<Restaurant>> {
    const all = [...this.rows.values()].filter((r) => r.tenantId === tenantId && !r.deletedAt);
    return { data: all, total: all.length };
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    const row = this.rows.get(id);
    if (row && row.tenantId === tenantId) {
      this.rows.delete(id);
    }
  }
}

/** In-memory fake — no DB, exercises the same contract as the TypeORM adapter. */
class FakeMenuItemRepository implements MenuItemRepository {
  private readonly rows = new Map<string, MenuItem>();

  async save(menuItem: MenuItem): Promise<MenuItem> {
    this.rows.set(menuItem.id, menuItem);
    return menuItem;
  }

  async findById(id: string, restaurantId: string, tenantId: string): Promise<MenuItem | null> {
    const row = this.rows.get(id);
    return row && row.restaurantId === restaurantId && row.tenantId === tenantId ? row : null;
  }

  async findAndCountByRestaurant(
    tenantId: string,
    restaurantId: string,
    _pagination: Pagination,
  ): Promise<PageResult<MenuItem>> {
    const all = [...this.rows.values()].filter(
      (item) => item.tenantId === tenantId && item.restaurantId === restaurantId,
    );
    return { data: all, total: all.length };
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    const row = this.rows.get(id);
    // Simulates soft-delete by removing from the visible set.
    if (row && row.tenantId === tenantId) {
      this.rows.delete(id);
    }
  }

  async softDeleteByRestaurant(restaurantId: string, tenantId: string): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.restaurantId === restaurantId && row.tenantId === tenantId) {
        this.rows.delete(id);
      }
    }
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

describe('menu-item application handlers', () => {
  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';

  let restaurantRepository: FakeRestaurantRepository;
  let menuItemRepository: FakeMenuItemRepository;
  let tenantContext: FakeTenantContext;
  let auditPort: FakeAuditPort;
  let transaction: FakeTransactionPort;
  let getRestaurant: GetRestaurantHandler;
  let createRestaurantHandler: CreateRestaurantHandler;
  let deleteRestaurant: DeleteRestaurantHandler;
  let getMenuItem: GetMenuItemHandler;
  let createMenuItem: CreateMenuItemHandler;
  let updateMenuItem: UpdateMenuItemHandler;
  let deleteMenuItem: DeleteMenuItemHandler;
  let listMenuItems: ListMenuItemsHandler;

  beforeEach(() => {
    restaurantRepository = new FakeRestaurantRepository();
    menuItemRepository = new FakeMenuItemRepository();
    tenantContext = new FakeTenantContext({ tenantId: tenantA, actor: 'test-suite' });
    auditPort = new FakeAuditPort();
    transaction = new FakeTransactionPort();
    getRestaurant = new GetRestaurantHandler(restaurantRepository, tenantContext);
    createRestaurantHandler = new CreateRestaurantHandler(
      restaurantRepository,
      tenantContext,
      auditPort,
      transaction,
    );
    deleteRestaurant = new DeleteRestaurantHandler(
      restaurantRepository,
      menuItemRepository,
      auditPort,
      transaction,
      getRestaurant,
    );
    getMenuItem = new GetMenuItemHandler(menuItemRepository, tenantContext);
    createMenuItem = new CreateMenuItemHandler(
      menuItemRepository,
      tenantContext,
      auditPort,
      transaction,
      getRestaurant,
    );
    updateMenuItem = new UpdateMenuItemHandler(
      menuItemRepository,
      auditPort,
      transaction,
      getMenuItem,
    );
    deleteMenuItem = new DeleteMenuItemHandler(
      menuItemRepository,
      auditPort,
      transaction,
      getMenuItem,
    );
    listMenuItems = new ListMenuItemsHandler(menuItemRepository, tenantContext, getRestaurant);
  });

  it('creates a menu item nested under a restaurant of the same tenant', async () => {
    const restaurant = await createRestaurantHandler.execute({ name: 'Pho House' });
    const menuItem = await createMenuItem.execute(restaurant.id, {
      name: 'Pho Bo',
      priceCents: 8500,
    });

    expect(menuItem.restaurantId).toBe(restaurant.id);
    expect(menuItem.tenantId).toBe(tenantA);
    expect(menuItem.priceCents).toBe(8500);

    const createEntry = auditPort.entries.find((e) => e.action === AuditAction.CREATE);
    expect(createEntry).toBeDefined();
  });

  it('rejects nesting a menu item under a restaurant owned by another tenant', async () => {
    const restaurant = await createRestaurantHandler.execute({ name: 'Tenant A Restaurant' });

    tenantContext.run({ tenantId: tenantB, actor: 'test-suite' }, () => {});
    await expect(
      createMenuItem.execute(restaurant.id, { name: 'Should Fail', priceCents: 100 }),
    ).rejects.toThrow(/not found/i);
  });

  it('excludes soft-deleted menu items from the listing but keeps siblings', async () => {
    const restaurant = await createRestaurantHandler.execute({ name: 'Pho House' });
    const keep = await createMenuItem.execute(restaurant.id, { name: 'Pho Bo', priceCents: 8500 });
    const remove = await createMenuItem.execute(restaurant.id, {
      name: 'Pho Ga',
      priceCents: 7500,
    });

    await deleteMenuItem.execute(restaurant.id, remove.id);

    const list = await listMenuItems.execute(restaurant.id, { page: 1, limit: 20 });
    expect(list.data.map((item) => item.id)).toEqual([keep.id]);

    const deleteEntry = auditPort.entries.find((e) => e.action === AuditAction.DELETE);
    expect(deleteEntry?.entityId).toBe(remove.id);
  });

  it('soft-deletes a restaurant and cascades the soft-delete to its menu items', async () => {
    const restaurant = await createRestaurantHandler.execute({ name: 'Pho House' });
    await createMenuItem.execute(restaurant.id, { name: 'Pho Bo', priceCents: 8500 });
    await createMenuItem.execute(restaurant.id, { name: 'Pho Ga', priceCents: 7500 });

    await deleteRestaurant.execute(restaurant.id);

    // Parent is gone (404s), and its menu items are no longer visible to menu-item queries.
    await expect(getRestaurant.execute(restaurant.id)).rejects.toThrow(/not found/i);
    const remaining = await menuItemRepository.findAndCountByRestaurant(tenantA, restaurant.id, {
      page: 1,
      limit: 20,
    });
    expect(remaining.total).toBe(0);
  });

  it('records a before/after snapshot on update', async () => {
    const restaurant = await createRestaurantHandler.execute({ name: 'Pho House' });
    const menuItem = await createMenuItem.execute(restaurant.id, {
      name: 'Pho Bo',
      priceCents: 8500,
    });

    const updated = await updateMenuItem.execute(restaurant.id, menuItem.id, { priceCents: 9000 });

    expect(updated.priceCents).toBe(9000);
    const updateEntry = auditPort.entries.find((e) => e.action === AuditAction.UPDATE);
    expect(updateEntry?.before).toMatchObject({ priceCents: 8500 });
    expect(updateEntry?.after).toMatchObject({ priceCents: 9000 });
  });
});
