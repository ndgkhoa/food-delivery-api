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

export function buildDataSourceOptions(env: OrderDbEnv): DataSourceOptions {
  return {
    ...buildReplicatedDataSourceOptions(env),
    entities: orderOrmEntities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
