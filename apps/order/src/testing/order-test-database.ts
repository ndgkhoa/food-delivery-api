import { CreateOrderTables1753747400000 } from '@order/infrastructure/persistence/migrations/1753747400000-create-order-tables';
import { CreateOrderSagaAndOutbox1753747500000 } from '@order/infrastructure/persistence/migrations/1753747500000-create-order-saga-and-outbox';
import { AddOrderSagaReaperIndex1753747900000 } from '@order/infrastructure/persistence/migrations/1753747900000-add-order-saga-reaper-index';
import { AddOrderPricingColumns1753748000000 } from '@order/infrastructure/persistence/migrations/1753748000000-add-order-pricing-columns';
import { AddOrderRestaurantId1753748100000 } from '@order/infrastructure/persistence/migrations/1753748100000-add-order-restaurant-id';
import { orderOrmEntities } from '@order/infrastructure/persistence/typeorm-options';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

export interface OrderTestDatabase {
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
}

/**
 * Spins up a real, throwaway Postgres via testcontainers and applies the
 * order migration, so integration tests assert against the same schema/CHECK
 * constraints as production. Migration is passed as a class reference (not a
 * glob) so it loads inside ts-jest without a separate ts-node step.
 */
export async function startOrderTestDatabase(): Promise<OrderTestDatabase> {
  const container = await new PostgreSqlContainer('postgres:18.4').start();

  const dataSource = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    entities: orderOrmEntities,
    migrations: [
      CreateOrderTables1753747400000,
      CreateOrderSagaAndOutbox1753747500000,
      AddOrderSagaReaperIndex1753747900000,
      AddOrderPricingColumns1753748000000,
      AddOrderRestaurantId1753748100000,
    ],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations();

  return { container, dataSource };
}

export async function stopOrderTestDatabase({
  container,
  dataSource,
}: OrderTestDatabase): Promise<void> {
  await dataSource.destroy();
  await container.stop();
}

export async function truncateOrderTables(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE "processed_events", "order_saga", "order_outbox", "idempotency_keys", "order_items", "orders" RESTART IDENTITY CASCADE',
  );
}
