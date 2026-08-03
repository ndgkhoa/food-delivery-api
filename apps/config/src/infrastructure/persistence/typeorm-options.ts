import { join } from 'node:path';
import { ConfigEntryOrmEntity } from '@config/infrastructure/persistence/entities/config-entry.orm-entity';
import { FeatureFlagOrmEntity } from '@config/infrastructure/persistence/entities/feature-flag.orm-entity';
import type { DataSourceOptions } from 'typeorm';

const configOrmEntities = [ConfigEntryOrmEntity, FeatureFlagOrmEntity];

export interface ConfigDbEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

/**
 * Single source of truth for Postgres connection + entity/migration discovery,
 * shared by the runtime `PersistenceModule` (via `ConfigService`) and the
 * standalone TypeORM CLI `DataSource` used to run migrations outside Nest's DI.
 *
 * `synchronize` is always false — schema changes happen ONLY via migrations.
 */
export function buildDataSourceOptions(env: ConfigDbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: configOrmEntities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
