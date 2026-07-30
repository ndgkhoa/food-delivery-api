import 'dotenv/config';
import 'reflect-metadata';
import { buildDataSourceOptions } from '@order/infrastructure/persistence/typeorm-options';
import { DataSource } from 'typeorm';

/**
 * Standalone DataSource for the TypeORM CLI (order migration
 * generate/run/revert scripts). Reads straight from `process.env` since the
 * CLI runs outside Nest's DI container. Uses the shared core Postgres (host
 * port 5432) under its own `order` database — override DB_NAME when the
 * shared `.env` points DB_* at another service.
 *
 * DB_REPLICA_* is accepted only so this DataSource matches the runtime's
 * shape; TypeORM always runs schema-changing operations (migrations) against
 * the `replication.master` connection, NEVER a replica, regardless of these
 * values.
 */
const orderDataSource = new DataSource(
  buildDataSourceOptions({
    DB_HOST: process.env.DB_HOST ?? 'localhost',
    DB_PORT: Number(process.env.DB_PORT ?? 5432),
    DB_USERNAME: process.env.DB_USERNAME ?? 'postgres',
    DB_PASSWORD: process.env.DB_PASSWORD ?? 'postgres',
    DB_NAME: process.env.DB_NAME ?? 'order',
    DB_REPLICA_HOST: process.env.DB_REPLICA_HOST,
    DB_REPLICA_PORT: process.env.DB_REPLICA_PORT ? Number(process.env.DB_REPLICA_PORT) : undefined,
  }),
);

export default orderDataSource;
