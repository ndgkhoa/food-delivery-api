import 'dotenv/config';
import 'reflect-metadata';
import { buildDataSourceOptions } from '@review/infrastructure/persistence/typeorm-options';
import { DataSource } from 'typeorm';

const reviewDataSource = new DataSource(
  buildDataSourceOptions({
    DB_HOST: process.env.DB_HOST ?? 'localhost',
    DB_PORT: Number(process.env.DB_PORT ?? 5432),
    DB_USERNAME: process.env.DB_USERNAME ?? 'postgres',
    DB_PASSWORD: process.env.DB_PASSWORD ?? 'postgres',
    DB_NAME: process.env.DB_NAME ?? 'review',
  }),
);

export default reviewDataSource;
