import { join } from 'node:path';
import { PaymentOutboxOrmEntity } from '@payment/infrastructure/persistence/entities/payment-outbox.orm-entity';
import { ProcessedEventOrmEntity } from '@payment/infrastructure/persistence/entities/processed-event.orm-entity';
import type { DataSourceOptions } from 'typeorm';

export const paymentOrmEntities = [PaymentOutboxOrmEntity, ProcessedEventOrmEntity];

export interface PaymentDbEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

export function buildDataSourceOptions(env: PaymentDbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: paymentOrmEntities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
