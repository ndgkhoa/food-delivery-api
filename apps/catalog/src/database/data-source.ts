import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './typeorm-options';

/**
 * Standalone DataSource for the `typeorm-ts-node-commonjs` CLI (migration
 * generate/run/revert scripts in root package.json). Reads straight from
 * `process.env` (loaded via `dotenv/config`) since the CLI runs outside
 * Nest's DI container and can't use `ConfigService`.
 */
const dataSourceOptions = buildDataSourceOptions({
  DB_HOST: process.env.DB_HOST ?? 'localhost',
  DB_PORT: Number(process.env.DB_PORT ?? 5432),
  DB_USERNAME: process.env.DB_USERNAME ?? 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD ?? 'postgres',
  DB_NAME: process.env.DB_NAME ?? 'catalog',
});

const catalogDataSource = new DataSource(dataSourceOptions);

export default catalogDataSource;
