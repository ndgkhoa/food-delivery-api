import { join } from 'node:path';
import { AuditLogOrmEntity } from '@catalog/infrastructure/persistence/entities/audit-log.orm-entity';
import { MenuItemOrmEntity } from '@catalog/infrastructure/persistence/entities/menu-item.orm-entity';
import { OutboxOrmEntity } from '@catalog/infrastructure/persistence/entities/outbox.orm-entity';
import { ProcessedEventOrmEntity } from '@catalog/infrastructure/persistence/entities/processed-event.orm-entity';
import { ReadMenuItemOrmEntity } from '@catalog/infrastructure/persistence/entities/read-menu-item.orm-entity';
import { ReadRestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/read-restaurant.orm-entity';
import { RestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/restaurant.orm-entity';
import type { DataSourceOptions } from 'typeorm';

export const catalogOrmEntities = [
  RestaurantOrmEntity,
  MenuItemOrmEntity,
  AuditLogOrmEntity,
  OutboxOrmEntity,
  ProcessedEventOrmEntity,
  ReadRestaurantOrmEntity,
  ReadMenuItemOrmEntity,
];

export interface CatalogDbEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

/**
 * Single source of truth for Postgres connection + entity/migration
 * discovery, shared by the runtime `PersistenceModule` (via Nest's
 * `ConfigService`) and the standalone TypeORM CLI `DataSource` used to
 * generate/run migrations outside of Nest's DI container.
 *
 * `synchronize` is always false — schema changes ONLY happen via migrations,
 * never implicit sync (architecture.md §5).
 */
export function buildDataSourceOptions(env: CatalogDbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: catalogOrmEntities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
