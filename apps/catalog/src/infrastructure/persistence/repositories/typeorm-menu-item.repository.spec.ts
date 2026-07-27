import { MenuItem } from '@catalog/domain/menu-item/menu-item';
import { Restaurant } from '@catalog/domain/restaurant/restaurant';
import { MenuItemOrmEntity } from '@catalog/infrastructure/persistence/entities/menu-item.orm-entity';
import { RestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/restaurant.orm-entity';
import { TypeOrmMenuItemRepository } from '@catalog/infrastructure/persistence/repositories/typeorm-menu-item.repository';
import { TypeOrmRestaurantRepository } from '@catalog/infrastructure/persistence/repositories/typeorm-restaurant.repository';
import {
  type CatalogTestDatabase,
  startCatalogTestDatabase,
  stopCatalogTestDatabase,
  truncateCatalogTables,
} from '@catalog/testing/catalog-test-database';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

/**
 * Integration test: real Postgres via testcontainers, real migrated schema.
 * Exercises `TypeOrmMenuItemRepository` end-to-end (which internally uses
 * `MenuItemMapper`), so mapper correctness is covered by round-tripping
 * through the actual database rather than by a separate mock-based test.
 */
describe('TypeOrmMenuItemRepository (integration)', () => {
  let db: CatalogTestDatabase;
  let menuItemRepository: TypeOrmMenuItemRepository;
  let restaurantRepository: TypeOrmRestaurantRepository;

  const tenantA = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    db = await startCatalogTestDatabase();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TypeOrmMenuItemRepository,
        TypeOrmRestaurantRepository,
        {
          provide: getRepositoryToken(MenuItemOrmEntity),
          useValue: db.dataSource.getRepository(MenuItemOrmEntity),
        },
        {
          provide: getRepositoryToken(RestaurantOrmEntity),
          useValue: db.dataSource.getRepository(RestaurantOrmEntity),
        },
      ],
    }).compile();

    menuItemRepository = moduleRef.get(TypeOrmMenuItemRepository);
    restaurantRepository = moduleRef.get(TypeOrmRestaurantRepository);
  }, 60000);

  afterAll(async () => {
    await stopCatalogTestDatabase(db);
  });

  afterEach(async () => {
    await truncateCatalogTables(db.dataSource);
  });

  async function createRestaurant(): Promise<Restaurant> {
    return restaurantRepository.save(
      Restaurant.create({ id: crypto.randomUUID(), tenantId: tenantA, name: 'Pho House' }),
    );
  }

  it('persists a menu item and rehydrates it as a domain instance via findById', async () => {
    const restaurant = await createRestaurant();
    const menuItem = MenuItem.create({
      id: crypto.randomUUID(),
      tenantId: tenantA,
      restaurantId: restaurant.id,
      name: 'Pho Bo',
      priceCents: 8500,
    });
    await menuItemRepository.save(menuItem);

    const found = await menuItemRepository.findById(menuItem.id, restaurant.id, tenantA);

    expect(found).not.toBeNull();
    expect(found?.priceCents).toBe(8500);
  });

  it('scopes findAndCountByRestaurant to the given restaurant and tenant', async () => {
    const restaurantA = await createRestaurant();
    const restaurantB = await createRestaurant();

    await menuItemRepository.save(
      MenuItem.create({
        id: crypto.randomUUID(),
        tenantId: tenantA,
        restaurantId: restaurantA.id,
        name: 'Pho Bo',
        priceCents: 8500,
      }),
    );
    await menuItemRepository.save(
      MenuItem.create({
        id: crypto.randomUUID(),
        tenantId: tenantA,
        restaurantId: restaurantB.id,
        name: 'Banh Mi',
        priceCents: 5000,
      }),
    );

    const { data, total } = await menuItemRepository.findAndCountByRestaurant(
      tenantA,
      restaurantA.id,
      {
        page: 1,
        limit: 20,
      },
    );

    expect(total).toBe(1);
    expect(data[0]?.name).toBe('Pho Bo');
  });

  it('excludes soft-deleted menu items from reads', async () => {
    const restaurant = await createRestaurant();
    const menuItem = await menuItemRepository.save(
      MenuItem.create({
        id: crypto.randomUUID(),
        tenantId: tenantA,
        restaurantId: restaurant.id,
        name: 'Pho Ga',
        priceCents: 7500,
      }),
    );

    await menuItemRepository.softDelete(menuItem.id, tenantA);

    expect(await menuItemRepository.findById(menuItem.id, restaurant.id, tenantA)).toBeNull();
  });
});
