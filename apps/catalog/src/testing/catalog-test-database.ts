import { CreateCatalogTables1753574400000 } from '@catalog/infrastructure/persistence/migrations/1753574400000-create-catalog-tables';
import { CreateCatalogOutboxAndReadModel1753660800000 } from '@catalog/infrastructure/persistence/migrations/1753660800000-create-catalog-outbox-and-read-model';
import { AddRestaurantRating1754150000000 } from '@catalog/infrastructure/persistence/migrations/1754150000000-add-restaurant-rating';
import { catalogOrmEntities } from '@catalog/infrastructure/persistence/typeorm-options';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

export interface CatalogTestDatabase {
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
}

/**
 * Spins up a real, throwaway Postgres via testcontainers and applies the
 * catalog migration, so tests assert against the same schema/constraints as
 * production instead of a mock. Migration is passed as a class reference
 * (not a glob) so it loads inside ts-jest without a separate ts-node step.
 */
export async function startCatalogTestDatabase(): Promise<CatalogTestDatabase> {
  const container = await new PostgreSqlContainer('postgres:18.4').start();

  const dataSource = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    entities: catalogOrmEntities,
    migrations: [
      CreateCatalogTables1753574400000,
      CreateCatalogOutboxAndReadModel1753660800000,
      AddRestaurantRating1754150000000,
    ],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations();

  return { container, dataSource };
}

export async function stopCatalogTestDatabase({
  container,
  dataSource,
}: CatalogTestDatabase): Promise<void> {
  await dataSource.destroy();
  await container.stop();
}

export async function truncateCatalogTables(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE "audit_log", "menu_items", "restaurants", ' +
      '"outbox", "processed_events", "read_restaurants", "read_menu_items" ' +
      'RESTART IDENTITY CASCADE',
  );
}

/**
 * Copies live write-model rows into the read tables, standing in for the
 * Debezium→Kafka→projection loop that isn't running in an in-process test. Lets
 * read endpoints (served from the read model) be asserted deterministically
 * without a broker; the compose-based e2e exercises the real CDC path.
 */
export async function syncReadModelFromWriteModel(dataSource: DataSource): Promise<void> {
  await dataSource.query(`
    INSERT INTO "read_restaurants" (id, tenant_id, name, description, is_active, created_at, updated_at)
    SELECT id, tenant_id, name, description, is_active, created_at, updated_at
    FROM "restaurants" WHERE deleted_at IS NULL
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, description = EXCLUDED.description,
      is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at
  `);
  await dataSource.query(`
    INSERT INTO "read_menu_items" (id, restaurant_id, tenant_id, name, description, price_cents, is_available, created_at, updated_at)
    SELECT id, restaurant_id, tenant_id, name, description, price_cents, is_available, created_at, updated_at
    FROM "menu_items" WHERE deleted_at IS NULL
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, description = EXCLUDED.description,
      price_cents = EXCLUDED.price_cents, is_available = EXCLUDED.is_available,
      updated_at = EXCLUDED.updated_at
  `);
}
