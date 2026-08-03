import { join } from 'node:path';
import { NotificationOrmEntity } from '@notification/infrastructure/persistence/entities/notification.orm-entity';
import { ProcessedEventOrmEntity } from '@notification/infrastructure/persistence/entities/processed-event.orm-entity';
import type { DataSourceOptions } from 'typeorm';

const notificationOrmEntities = [NotificationOrmEntity, ProcessedEventOrmEntity];

export interface NotificationDbEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

/**
 * Single source of truth for the notification Postgres connection +
 * entity/migration discovery, shared by the runtime `PersistenceModule` (via
 * Nest's `ConfigService`) and the standalone TypeORM CLI `DataSource`.
 *
 * `synchronize` is always false — schema changes ONLY happen via migrations.
 */
export function buildDataSourceOptions(env: NotificationDbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: notificationOrmEntities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
