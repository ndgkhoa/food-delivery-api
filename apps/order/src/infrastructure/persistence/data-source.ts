import 'dotenv/config';
import 'reflect-metadata';
import { buildDataSourceOptions } from '@order/infrastructure/persistence/typeorm-options';
import { DataSource } from 'typeorm';

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
