import 'dotenv/config';
import 'reflect-metadata';
import { buildDataSourceOptions } from '@notification/infrastructure/persistence/typeorm-options';
import { DataSource } from 'typeorm';

/**
 * Standalone DataSource for the TypeORM CLI (notification migration
 * generate/run/revert scripts). Reads straight from `process.env` since the
 * CLI runs outside Nest's DI container. Uses the shared core Postgres (host
 * port 5432) under its own `notification` database — override DB_NAME when
 * the shared `.env` points DB_* at another service.
 */
const notificationDataSource = new DataSource(
  buildDataSourceOptions({
    DB_HOST: process.env.DB_HOST ?? 'localhost',
    DB_PORT: Number(process.env.DB_PORT ?? 5432),
    DB_USERNAME: process.env.DB_USERNAME ?? 'postgres',
    DB_PASSWORD: process.env.DB_PASSWORD ?? 'postgres',
    DB_NAME: process.env.DB_NAME ?? 'notification',
  }),
);

export default notificationDataSource;
