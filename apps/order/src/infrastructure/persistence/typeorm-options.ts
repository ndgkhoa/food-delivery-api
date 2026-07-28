import { join } from 'node:path';
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

export interface OrderDbEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

/**
 * Single source of truth for the order Postgres connection + entity/
 * migration discovery, shared by the runtime `PersistenceModule` (via Nest's
 * `ConfigService`) and the standalone TypeORM CLI `DataSource`.
 *
 * `synchronize` is always false — schema changes ONLY happen via migrations.
 */
export function buildDataSourceOptions(env: OrderDbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: orderOrmEntities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
