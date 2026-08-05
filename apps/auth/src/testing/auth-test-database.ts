import { CreateAuthTables1753660800000 } from '@auth/infrastructure/persistence/migrations/1753660800000-create-auth-tables';
import { authOrmEntities } from '@auth/infrastructure/persistence/typeorm-options';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

export interface AuthTestDatabase {
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
}

export async function startAuthTestDatabase(): Promise<AuthTestDatabase> {
  const container = await new PostgreSqlContainer('postgres:18.4').start();

  const dataSource = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    entities: authOrmEntities,
    migrations: [CreateAuthTables1753660800000],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations();

  return { container, dataSource };
}

export async function stopAuthTestDatabase({
  container,
  dataSource,
}: AuthTestDatabase): Promise<void> {
  await dataSource.destroy();
  await container.stop();
}

export async function truncateAuthTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE TABLE "user_tenant_map", "tenants" RESTART IDENTITY CASCADE');
}
