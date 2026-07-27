import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { AuditLog } from '../audit/audit-log.entity';
import { MenuItem } from '../menu-items/entities/menu-item.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';

export const catalogEntities = [Restaurant, MenuItem, AuditLog];

export interface CatalogDbEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

/**
 * Single source of truth for Postgres connection + entity/migration
 * discovery, shared by the runtime `DatabaseModule` (via Nest's
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
    entities: catalogEntities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
