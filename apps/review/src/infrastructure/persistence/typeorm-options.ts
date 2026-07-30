import { join } from 'node:path';
import { ProcessedEventOrmEntity } from '@review/infrastructure/persistence/entities/processed-event.orm-entity';
import { ReviewOrmEntity } from '@review/infrastructure/persistence/entities/review.orm-entity';
import { ReviewEligibleOrderOrmEntity } from '@review/infrastructure/persistence/entities/review-eligible-order.orm-entity';
import { ReviewOutboxOrmEntity } from '@review/infrastructure/persistence/entities/review-outbox.orm-entity';
import type { DataSourceOptions } from 'typeorm';

const reviewOrmEntities = [
  ReviewOrmEntity,
  ReviewEligibleOrderOrmEntity,
  ReviewOutboxOrmEntity,
  ProcessedEventOrmEntity,
];

export interface ReviewDbEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

/**
 * Single source of truth for the review Postgres connection +
 * entity/migration discovery, shared by the runtime `PersistenceModule` (via
 * Nest's `ConfigService`) and the standalone TypeORM CLI `DataSource`.
 *
 * `synchronize` is always false — schema changes ONLY happen via migrations.
 */
export function buildDataSourceOptions(env: ReviewDbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: reviewOrmEntities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
