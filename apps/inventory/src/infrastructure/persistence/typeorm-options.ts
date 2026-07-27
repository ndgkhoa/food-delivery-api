import { join } from 'node:path';
import { ReservationOrmEntity } from '@inventory/infrastructure/persistence/entities/reservation.orm-entity';
import { StockOrmEntity } from '@inventory/infrastructure/persistence/entities/stock.orm-entity';
import type { DataSourceOptions } from 'typeorm';

export const inventoryOrmEntities = [StockOrmEntity, ReservationOrmEntity];

export interface InventoryDbEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

/**
 * Single source of truth for the inventory Postgres connection + entity/
 * migration discovery, shared by the runtime `PersistenceModule` (via Nest's
 * `ConfigService`) and the standalone TypeORM CLI `DataSource`.
 *
 * `synchronize` is always false — schema changes ONLY happen via migrations.
 */
export function buildDataSourceOptions(env: InventoryDbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: inventoryOrmEntities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
