import { Restaurant } from '@catalog/domain/restaurant/restaurant';
import { ConcurrencyConflictError } from '@catalog/domain/shared/errors';
import { RestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/restaurant.orm-entity';
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
 * Exercises `TypeOrmRestaurantRepository` end-to-end (which internally uses
 * `RestaurantMapper`), so mapper correctness is covered by round-tripping
 * through the actual database rather than by a separate mock-based test.
 */
describe('TypeOrmRestaurantRepository (integration)', () => {
  let db: CatalogTestDatabase;
  let repository: TypeOrmRestaurantRepository;

  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    db = await startCatalogTestDatabase();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TypeOrmRestaurantRepository,
        {
          provide: getRepositoryToken(RestaurantOrmEntity),
          useValue: db.dataSource.getRepository(RestaurantOrmEntity),
        },
      ],
    }).compile();

    repository = moduleRef.get(TypeOrmRestaurantRepository);
  }, 60000);

  afterAll(async () => {
    await stopCatalogTestDatabase(db);
  });

  afterEach(async () => {
    await truncateCatalogTables(db.dataSource);
  });

  it('persists a restaurant and rehydrates it as a domain instance via findById', async () => {
    const restaurant = Restaurant.create({
      id: crypto.randomUUID(),
      tenantId: tenantA,
      name: 'Pho House',
    });
    await repository.save(restaurant);

    const found = await repository.findById(restaurant.id, tenantA);

    expect(found).not.toBeNull();
    expect(found?.name).toBe('Pho House');
    expect(found?.tenantId).toBe(tenantA);
  });

  it('does not return a restaurant scoped to a different tenant', async () => {
    const restaurant = Restaurant.create({
      id: crypto.randomUUID(),
      tenantId: tenantA,
      name: 'Tenant A Only',
    });
    await repository.save(restaurant);

    const found = await repository.findById(restaurant.id, tenantB);
    expect(found).toBeNull();
  });

  it('paginates findAndCount results ordered by createdAt desc', async () => {
    for (const name of ['First', 'Second', 'Third']) {
      await repository.save(
        Restaurant.create({ id: crypto.randomUUID(), tenantId: tenantA, name }),
      );
    }

    const page1 = await repository.findAndCount(tenantA, { page: 1, limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(3);

    const page2 = await repository.findAndCount(tenantA, { page: 2, limit: 2 });
    expect(page2.data).toHaveLength(1);
  });

  it('excludes soft-deleted restaurants from findById and findAndCount', async () => {
    const restaurant = Restaurant.create({
      id: crypto.randomUUID(),
      tenantId: tenantA,
      name: 'To Delete',
    });
    await repository.save(restaurant);

    await repository.softDelete(restaurant.id, tenantA);

    expect(await repository.findById(restaurant.id, tenantA)).toBeNull();
    const { data } = await repository.findAndCount(tenantA, { page: 1, limit: 20 });
    expect(data.find((r) => r.id === restaurant.id)).toBeUndefined();
  });

  describe('updateVersioned (optimistic locking)', () => {
    it('increments the version on a normal update against real Postgres', async () => {
      const restaurant = await repository.save(
        Restaurant.create({ id: crypto.randomUUID(), tenantId: tenantA, name: 'Pho House' }),
      );
      expect(restaurant.version).toBe(1);

      const saved = await repository.updateVersioned(restaurant.update({ name: 'Pho House 2' }));

      expect(saved.name).toBe('Pho House 2');
      expect(saved.version).toBe(2);
    });

    it('rejects a stale write against real Postgres: the WHERE version guard genuinely blocks it', async () => {
      const created = await repository.save(
        Restaurant.create({ id: crypto.randomUUID(), tenantId: tenantA, name: 'Pho House' }),
      );

      // Two concurrent PATCHes both load version 1 before either writes.
      const firstLoad = await repository.findById(created.id, tenantA);
      const secondLoad = await repository.findById(created.id, tenantA);
      if (!firstLoad || !secondLoad) {
        throw new Error('expected both loads to find the seeded restaurant');
      }

      // First writer commits — the row is now at version 2 in Postgres.
      const winner = await repository.updateVersioned(firstLoad.update({ name: 'Winner' }));
      expect(winner.version).toBe(2);

      // Second writer still holds the version-1 view — the atomic
      // `WHERE ... version = 1` update affects 0 rows in the real DB, so the
      // guard rejects it instead of silently overwriting the winner's write.
      await expect(
        repository.updateVersioned(secondLoad.update({ name: 'Loser' })),
      ).rejects.toThrow(ConcurrencyConflictError);

      // No lost update: the winner's write is what's actually in Postgres.
      const final = await repository.findById(created.id, tenantA);
      expect(final?.name).toBe('Winner');
      expect(final?.version).toBe(2);
    });
  });
});
