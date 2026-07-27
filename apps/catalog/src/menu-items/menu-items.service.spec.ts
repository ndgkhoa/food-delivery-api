import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/audit-log.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { RestaurantsService } from '../restaurants/restaurants.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  type CatalogTestDatabase,
  startCatalogTestDatabase,
  stopCatalogTestDatabase,
  truncateCatalogTables,
} from '../testing/catalog-test-database';
import { MenuItem } from './entities/menu-item.entity';
import { MenuItemsService } from './menu-items.service';

describe('MenuItemsService', () => {
  let db: CatalogTestDatabase;
  let menuItemsService: MenuItemsService;
  let restaurantsService: RestaurantsService;
  let tenantContext: TenantContextService;
  let auditRepository: Repository<AuditLog>;

  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    db = await startCatalogTestDatabase();

    const moduleRef = await Test.createTestingModule({
      providers: [
        MenuItemsService,
        RestaurantsService,
        AuditService,
        TenantContextService,
        {
          provide: getRepositoryToken(Restaurant),
          useValue: db.dataSource.getRepository(Restaurant),
        },
        { provide: getRepositoryToken(MenuItem), useValue: db.dataSource.getRepository(MenuItem) },
        { provide: getRepositoryToken(AuditLog), useValue: db.dataSource.getRepository(AuditLog) },
      ],
    }).compile();

    menuItemsService = moduleRef.get(MenuItemsService);
    restaurantsService = moduleRef.get(RestaurantsService);
    tenantContext = moduleRef.get(TenantContextService);
    auditRepository = db.dataSource.getRepository(AuditLog);
  }, 60000);

  afterAll(async () => {
    await stopCatalogTestDatabase(db);
  });

  afterEach(async () => {
    await truncateCatalogTables(db.dataSource);
  });

  function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId, actor: 'test-suite' }, fn);
  }

  it('creates a menu item nested under a restaurant of the same tenant', async () => {
    const restaurant = await asTenant(tenantA, () =>
      restaurantsService.create({ name: 'Pho House' }),
    );
    const menuItem = await asTenant(tenantA, () =>
      menuItemsService.create(restaurant.id, { name: 'Pho Bo', priceCents: 8500 }),
    );

    expect(menuItem.restaurantId).toBe(restaurant.id);
    expect(menuItem.tenantId).toBe(tenantA);
    expect(menuItem.priceCents).toBe(8500);

    const auditRow = await auditRepository.findOne({
      where: { entityId: menuItem.id, action: 'CREATE' as never },
    });
    expect(auditRow).not.toBeNull();
  });

  it('rejects nesting a menu item under a restaurant owned by another tenant', async () => {
    const restaurant = await asTenant(tenantA, () =>
      restaurantsService.create({ name: 'Tenant A Restaurant' }),
    );

    await expect(
      asTenant(tenantB, () =>
        menuItemsService.create(restaurant.id, { name: 'Should Fail', priceCents: 100 }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('excludes soft-deleted menu items from the listing but keeps siblings', async () => {
    const restaurant = await asTenant(tenantA, () =>
      restaurantsService.create({ name: 'Pho House' }),
    );
    const keep = await asTenant(tenantA, () =>
      menuItemsService.create(restaurant.id, { name: 'Pho Bo', priceCents: 8500 }),
    );
    const remove = await asTenant(tenantA, () =>
      menuItemsService.create(restaurant.id, { name: 'Pho Ga', priceCents: 7500 }),
    );

    await asTenant(tenantA, () => menuItemsService.remove(restaurant.id, remove.id));

    const list = await asTenant(tenantA, () =>
      menuItemsService.findAllForRestaurant(restaurant.id, { page: 1, limit: 20 }),
    );

    expect(list.data.map((item) => item.id)).toEqual([keep.id]);
  });
});
