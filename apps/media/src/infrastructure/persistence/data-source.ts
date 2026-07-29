import 'dotenv/config';
import 'reflect-metadata';
import { buildDataSourceOptions } from '@media/infrastructure/persistence/typeorm-options';
import { DataSource } from 'typeorm';

/**
 * Standalone DataSource for the TypeORM CLI (migration run/revert scripts in
 * root package.json). Reads straight from `process.env` since the CLI runs
 * outside Nest's DI container and cannot use `ConfigService`.
 */
const dataSourceOptions = buildDataSourceOptions({
  DB_HOST: process.env.DB_HOST ?? 'localhost',
  DB_PORT: Number(process.env.DB_PORT ?? 5432),
  DB_USERNAME: process.env.DB_USERNAME ?? 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD ?? 'postgres',
  DB_NAME: process.env.DB_NAME ?? 'media',
});

const mediaDataSource = new DataSource(dataSourceOptions);

export default mediaDataSource;
