import { CreateCatalogTables1753574400000 } from '@catalog/infrastructure/persistence/migrations/1753574400000-create-catalog-tables';
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
    migrations: [CreateCatalogTables1753574400000],
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
    'TRUNCATE TABLE "audit_log", "menu_items", "restaurants" RESTART IDENTITY CASCADE',
  );
}
