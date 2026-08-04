import { CreateInventoryTables1753747200000 } from '@inventory/infrastructure/persistence/migrations/1753747200000-create-inventory-tables';
import { AddActiveReservationUniqueIndex1753747300000 } from '@inventory/infrastructure/persistence/migrations/1753747300000-add-active-reservation-unique-index';
import { CreateInventoryOutbox1753747600000 } from '@inventory/infrastructure/persistence/migrations/1753747600000-create-inventory-outbox';
import { AddTraceParentToInventoryOutbox1753747700000 } from '@inventory/infrastructure/persistence/migrations/1753747700000-add-trace-parent-to-inventory-outbox';
import { inventoryOrmEntities } from '@inventory/infrastructure/persistence/typeorm-options';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

export interface InventoryTestDatabase {
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
}

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
    migrations: [
      CreateInventoryTables1753747200000,
      AddActiveReservationUniqueIndex1753747300000,
      CreateInventoryOutbox1753747600000,
      AddTraceParentToInventoryOutbox1753747700000,
    ],
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
  await dataSource.query(
    'TRUNCATE TABLE "processed_events", "inventory_outbox", "reservations", "stock" RESTART IDENTITY CASCADE',
  );
}
