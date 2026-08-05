import { CreateOrderTables1753747400000 } from '@order/infrastructure/persistence/migrations/1753747400000-create-order-tables';
import { CreateOrderSagaAndOutbox1753747500000 } from '@order/infrastructure/persistence/migrations/1753747500000-create-order-saga-and-outbox';
import { AddOrderSagaReaperIndex1753747900000 } from '@order/infrastructure/persistence/migrations/1753747900000-add-order-saga-reaper-index';
import { AddOrderPricingColumns1753748000000 } from '@order/infrastructure/persistence/migrations/1753748000000-add-order-pricing-columns';
import { AddOrderRestaurantId1753748100000 } from '@order/infrastructure/persistence/migrations/1753748100000-add-order-restaurant-id';
import { PartitionOrdersByMonth1753748200000 } from '@order/infrastructure/persistence/migrations/1753748200000-partition-orders-by-month';
import { IndexOrdersTenantUserCreated1753748300000 } from '@order/infrastructure/persistence/migrations/1753748300000-index-orders-tenant-user-created';
import { AddTraceParentToOrderOutbox1753748400000 } from '@order/infrastructure/persistence/migrations/1753748400000-add-trace-parent-to-order-outbox';
import { AddAttemptsToOrderSaga1753748500000 } from '@order/infrastructure/persistence/migrations/1753748500000-add-attempts-to-order-saga';
import { orderOrmEntities } from '@order/infrastructure/persistence/typeorm-options';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

export interface OrderTestDatabase {
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
}

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
      PartitionOrdersByMonth1753748200000,
      IndexOrdersTenantUserCreated1753748300000,
      AddTraceParentToOrderOutbox1753748400000,
      AddAttemptsToOrderSaga1753748500000,
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
