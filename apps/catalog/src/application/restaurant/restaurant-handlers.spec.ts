import type { Restaurant } from '../../domain/restaurant/restaurant';
import type { RestaurantRepository } from '../../domain/restaurant/restaurant.repository';
import type { AuditEntry, AuditPort } from '../../domain/shared/audit.port';
import { AuditAction } from '../../domain/shared/audit-action';
import type { PageResult, Pagination } from '../../domain/shared/pagination';
import type {
  TenantContextPort,
  TenantRequestContext,
} from '../../domain/shared/tenant-context.port';
import { CreateRestaurantHandler } from './commands/create-restaurant.handler';
import { DeleteRestaurantHandler } from './commands/delete-restaurant.handler';
import { UpdateRestaurantHandler } from './commands/update-restaurant.handler';
import { GetRestaurantHandler } from './queries/get-restaurant.handler';
import { ListRestaurantsHandler } from './queries/list-restaurants.handler';

/** In-memory fake — no DB, exercises the same contract as the TypeORM adapter. */
class FakeRestaurantRepository implements RestaurantRepository {
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

describe('restaurant application handlers', () => {
  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';

  let repository: FakeRestaurantRepository;
  let tenantContext: FakeTenantContext;
  let auditPort: FakeAuditPort;
  let getRestaurant: GetRestaurantHandler;
  let createRestaurant: CreateRestaurantHandler;
  let updateRestaurant: UpdateRestaurantHandler;
  let deleteRestaurant: DeleteRestaurantHandler;
  let listRestaurants: ListRestaurantsHandler;

  beforeEach(() => {
    repository = new FakeRestaurantRepository();
    tenantContext = new FakeTenantContext({ tenantId: tenantA, actor: 'test-suite' });
    auditPort = new FakeAuditPort();
    getRestaurant = new GetRestaurantHandler(repository, tenantContext);
    createRestaurant = new CreateRestaurantHandler(repository, tenantContext, auditPort);
    updateRestaurant = new UpdateRestaurantHandler(repository, auditPort, getRestaurant);
    deleteRestaurant = new DeleteRestaurantHandler(repository, auditPort, getRestaurant);
    listRestaurants = new ListRestaurantsHandler(repository, tenantContext);
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
  });

  it('excludes soft-deleted restaurants from findAll and get', async () => {
    const restaurant = await createRestaurant.execute({ name: 'Banh Mi Corner' });
    await deleteRestaurant.execute(restaurant.id);

    const list = await listRestaurants.execute({ page: 1, limit: 20 });
    expect(list.data.find((r) => r.id === restaurant.id)).toBeUndefined();

    await expect(getRestaurant.execute(restaurant.id)).rejects.toThrow(/not found/i);

    const deleteEntry = auditPort.entries.find((e) => e.action === AuditAction.DELETE);
    expect(deleteEntry).toBeDefined();
  });

  it("does not allow one tenant to read another tenant's restaurant", async () => {
    const restaurant = await createRestaurant.execute({ name: 'Tenant A Only' });

    tenantContext.run({ tenantId: tenantB, actor: 'test-suite' }, () => {});
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
