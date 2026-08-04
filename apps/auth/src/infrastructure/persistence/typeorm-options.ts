import { join } from 'node:path';
import { TenantOrmEntity } from '@auth/infrastructure/persistence/entities/tenant.orm-entity';
import { UserTenantMapOrmEntity } from '@auth/infrastructure/persistence/entities/user-tenant-map.orm-entity';
import type { DataSourceOptions } from 'typeorm';

export const authOrmEntities = [TenantOrmEntity, UserTenantMapOrmEntity];

export interface AuthDbEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

export function buildDataSourceOptions(env: AuthDbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: authOrmEntities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
}
