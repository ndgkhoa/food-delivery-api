import { MenuItem } from '@catalog/domain/menu-item/menu-item';
import { Restaurant } from '@catalog/domain/restaurant/restaurant';
import { ConcurrencyConflictError } from '@catalog/domain/shared/errors';
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

  async function buildRestaurant(): Promise<Restaurant> {
    return restaurantRepository.save(
      Restaurant.create({ id: crypto.randomUUID(), tenantId: tenantA, name: 'Pho House' }),
    );
  }

  it('persists a menu item and rehydrates it as a domain instance via findById', async () => {
    const restaurant = await buildRestaurant();
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
    const restaurantA = await buildRestaurant();
    const restaurantB = await buildRestaurant();

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
    const restaurant = await buildRestaurant();
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

  it('returns an empty array from findManyByIds without querying when given no ids', async () => {
    const result = await menuItemRepository.findManyByIds([], tenantA);

    expect(result).toEqual([]);
  });

  it('finds many menu items by id scoped to the tenant', async () => {
    const restaurant = await buildRestaurant();
    const pho = await menuItemRepository.save(
      MenuItem.create({
        id: crypto.randomUUID(),
        tenantId: tenantA,
        restaurantId: restaurant.id,
        name: 'Pho Bo',
        priceCents: 8500,
      }),
    );
    const banhMi = await menuItemRepository.save(
      MenuItem.create({
        id: crypto.randomUUID(),
        tenantId: tenantA,
        restaurantId: restaurant.id,
        name: 'Banh Mi',
        priceCents: 5000,
      }),
    );

    const found = await menuItemRepository.findManyByIds([pho.id, banhMi.id], tenantA);

    expect(found.map((item) => item.name).sort()).toEqual(['Banh Mi', 'Pho Bo']);
  });

  it('lists all menu items for a restaurant regardless of pagination', async () => {
    const restaurant = await buildRestaurant();
    await menuItemRepository.save(
      MenuItem.create({
        id: crypto.randomUUID(),
        tenantId: tenantA,
        restaurantId: restaurant.id,
        name: 'Pho Bo',
        priceCents: 8500,
      }),
    );
    await menuItemRepository.save(
      MenuItem.create({
        id: crypto.randomUUID(),
        tenantId: tenantA,
        restaurantId: restaurant.id,
        name: 'Banh Mi',
        priceCents: 5000,
      }),
    );

    const all = await menuItemRepository.findAllByRestaurant(restaurant.id, tenantA);

    expect(all).toHaveLength(2);
  });

  it('soft-deletes every menu item belonging to a restaurant', async () => {
    const restaurant = await buildRestaurant();
    const pho = await menuItemRepository.save(
      MenuItem.create({
        id: crypto.randomUUID(),
        tenantId: tenantA,
        restaurantId: restaurant.id,
        name: 'Pho Bo',
        priceCents: 8500,
      }),
    );
    const banhMi = await menuItemRepository.save(
      MenuItem.create({
        id: crypto.randomUUID(),
        tenantId: tenantA,
        restaurantId: restaurant.id,
        name: 'Banh Mi',
        priceCents: 5000,
      }),
    );

    await menuItemRepository.softDeleteByRestaurant(restaurant.id, tenantA);

    expect(await menuItemRepository.findById(pho.id, restaurant.id, tenantA)).toBeNull();
    expect(await menuItemRepository.findById(banhMi.id, restaurant.id, tenantA)).toBeNull();
  });

  describe('updateVersioned (optimistic locking)', () => {
    it('increments the version on a normal update against real Postgres', async () => {
      const restaurant = await buildRestaurant();
      const menuItem = await menuItemRepository.save(
        MenuItem.create({
          id: crypto.randomUUID(),
          tenantId: tenantA,
          restaurantId: restaurant.id,
          name: 'Pho Bo',
          priceCents: 8500,
        }),
      );
      expect(menuItem.version).toBe(1);

      const saved = await menuItemRepository.updateVersioned(menuItem.update({ priceCents: 9000 }));

      expect(saved.priceCents).toBe(9000);
      expect(saved.version).toBe(2);
    });

    it('rejects a stale write against real Postgres: the WHERE version guard genuinely blocks it', async () => {
      const restaurant = await buildRestaurant();
      const created = await menuItemRepository.save(
        MenuItem.create({
          id: crypto.randomUUID(),
          tenantId: tenantA,
          restaurantId: restaurant.id,
          name: 'Pho Bo',
          priceCents: 8500,
        }),
      );

      const firstLoad = await menuItemRepository.findById(created.id, restaurant.id, tenantA);
      const secondLoad = await menuItemRepository.findById(created.id, restaurant.id, tenantA);
      if (!firstLoad || !secondLoad) {
        throw new Error('expected both loads to find the seeded menu item');
      }

      const winner = await menuItemRepository.updateVersioned(
        firstLoad.update({ priceCents: 9000 }),
      );
      expect(winner.version).toBe(2);

      await expect(
        menuItemRepository.updateVersioned(secondLoad.update({ priceCents: 7000 })),
      ).rejects.toThrow(ConcurrencyConflictError);

      const final = await menuItemRepository.findById(created.id, restaurant.id, tenantA);
      expect(final?.priceCents).toBe(9000);
      expect(final?.version).toBe(2);
    });
  });
});
