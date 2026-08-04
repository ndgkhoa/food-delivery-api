import 'dotenv/config';
import 'reflect-metadata';
import { buildDataSourceOptions } from '@config/infrastructure/persistence/typeorm-options';
import { DataSource } from 'typeorm';

const dataSourceOptions = buildDataSourceOptions({
  DB_HOST: process.env.DB_HOST ?? 'localhost',
  DB_PORT: Number(process.env.DB_PORT ?? 5432),
  DB_USERNAME: process.env.DB_USERNAME ?? 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD ?? 'postgres',
  DB_NAME: process.env.DB_NAME ?? 'config',
});

const configDataSource = new DataSource(dataSourceOptions);

export default configDataSource;
