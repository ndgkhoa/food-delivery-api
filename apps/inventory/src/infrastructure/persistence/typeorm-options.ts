import { join } from 'node:path';
import { InventoryOutboxOrmEntity } from '@inventory/infrastructure/persistence/entities/inventory-outbox.orm-entity';
import { ProcessedEventOrmEntity } from '@inventory/infrastructure/persistence/entities/processed-event.orm-entity';
import { ReservationOrmEntity } from '@inventory/infrastructure/persistence/entities/reservation.orm-entity';
import { StockOrmEntity } from '@inventory/infrastructure/persistence/entities/stock.orm-entity';
import type { DataSourceOptions } from 'typeorm';

export const inventoryOrmEntities = [
  StockOrmEntity,
  ReservationOrmEntity,
  InventoryOutboxOrmEntity,
  ProcessedEventOrmEntity,
];

export interface InventoryDbEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

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
