import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { AuditLogOrmEntity } from './entities/audit-log.orm-entity';
import { MenuItemOrmEntity } from './entities/menu-item.orm-entity';
import { RestaurantOrmEntity } from './entities/restaurant.orm-entity';

export const catalogOrmEntities = [RestaurantOrmEntity, MenuItemOrmEntity, AuditLogOrmEntity];

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
