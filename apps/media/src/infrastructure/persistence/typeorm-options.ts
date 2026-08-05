import { join } from 'node:path';
import { MediaObjectOrmEntity } from '@media/infrastructure/persistence/entities/media-object.orm-entity';
import type { DataSourceOptions } from 'typeorm';

const mediaOrmEntities = [MediaObjectOrmEntity];

export interface MediaDbEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

export function buildDataSourceOptions(env: MediaDbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: mediaOrmEntities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
