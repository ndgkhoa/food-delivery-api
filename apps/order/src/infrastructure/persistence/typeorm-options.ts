import { join } from 'node:path';
import {
  buildReplicatedDataSourceOptions,
  type ReplicatedPostgresEnv,
} from '@food-delivery-api/shared-persistence';
import { IdempotencyKeyOrmEntity } from '@order/infrastructure/persistence/entities/idempotency-key.orm-entity';
import { OrderOrmEntity } from '@order/infrastructure/persistence/entities/order.orm-entity';
import { OrderItemOrmEntity } from '@order/infrastructure/persistence/entities/order-item.orm-entity';
import { OrderOutboxOrmEntity } from '@order/infrastructure/persistence/entities/order-outbox.orm-entity';
import { OrderSagaOrmEntity } from '@order/infrastructure/persistence/entities/order-saga.orm-entity';
import { ProcessedEventOrmEntity } from '@order/infrastructure/persistence/entities/processed-event.orm-entity';
import type { DataSourceOptions } from 'typeorm';

export const orderOrmEntities = [
  OrderOrmEntity,
  OrderItemOrmEntity,
  IdempotencyKeyOrmEntity,
  OrderOutboxOrmEntity,
  OrderSagaOrmEntity,
  ProcessedEventOrmEntity,
];

export type OrderDbEnv = ReplicatedPostgresEnv;

/**
 * Single source of truth for the order Postgres connection + entity/
 * migration discovery, shared by the runtime `PersistenceModule` (via Nest's
 * `ConfigService`) and the standalone TypeORM CLI `DataSource`.
 *
 * The connection is a `replication { master, slaves }` data source (see
 * `@food-delivery-api/shared-persistence`): reads default to master (so every
 * existing repository call stays read-your-writes safe with zero changes),
 * and only `TypeOrmOrderRepository.findRecentByTenant` (order history — never
 * a row its own caller just wrote) explicitly opts into the replica via
 * `readFromSlave`. When `DB_REPLICA_HOST` is unset the slave pool falls back
 * to the master connection, so single-node dev is unaffected.
 *
 * `synchronize` is always false — schema changes ONLY happen via migrations,
 * which TypeORM always runs against the master.
 */
export function buildDataSourceOptions(env: OrderDbEnv): DataSourceOptions {
  return {
    ...buildReplicatedDataSourceOptions(env),
    entities: orderOrmEntities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
