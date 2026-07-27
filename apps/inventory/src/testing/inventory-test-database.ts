import { CreateInventoryTables1753747200000 } from '@inventory/infrastructure/persistence/migrations/1753747200000-create-inventory-tables';
import { inventoryOrmEntities } from '@inventory/infrastructure/persistence/typeorm-options';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

export interface InventoryTestDatabase {
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
}

/**
 * Spins up a real, throwaway Postgres via testcontainers and applies the
 * inventory migration, so integration tests (incl. the no-oversell concurrency
 * proof) assert against the same schema/CHECK constraints as production.
 * Migration is passed as a class reference (not a glob) so it loads inside
 * ts-jest without a separate ts-node step.
 */
export async function startInventoryTestDatabase(): Promise<InventoryTestDatabase> {
  const container = await new PostgreSqlContainer('postgres:18.4').start();

  const dataSource = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    entities: inventoryOrmEntities,
    migrations: [CreateInventoryTables1753747200000],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations();

  return { container, dataSource };
}

export async function stopInventoryTestDatabase({
  container,
  dataSource,
}: InventoryTestDatabase): Promise<void> {
  await dataSource.destroy();
  await container.stop();
}

export async function truncateInventoryTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE TABLE "reservations", "stock" RESTART IDENTITY CASCADE');
}
