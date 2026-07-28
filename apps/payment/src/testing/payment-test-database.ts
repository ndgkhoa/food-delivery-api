import { CreatePaymentOutbox1753747700000 } from '@payment/infrastructure/persistence/migrations/1753747700000-create-payment-outbox';
import { paymentOrmEntities } from '@payment/infrastructure/persistence/typeorm-options';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

export interface PaymentTestDatabase {
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
}

/**
 * Spins up a real, throwaway Postgres via testcontainers and applies the
 * payment migration, so the compose/e2e stack asserts against the same schema as
 * production. Migration is passed as a class reference (not a glob) so it loads
 * inside ts-jest without a separate ts-node step.
 */
export async function startPaymentTestDatabase(): Promise<PaymentTestDatabase> {
  const container = await new PostgreSqlContainer('postgres:18.4').start();

  const dataSource = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    entities: paymentOrmEntities,
    migrations: [CreatePaymentOutbox1753747700000],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations();

  return { container, dataSource };
}

export async function stopPaymentTestDatabase({
  container,
  dataSource,
}: PaymentTestDatabase): Promise<void> {
  await dataSource.destroy();
  await container.stop();
}

export async function truncatePaymentTables(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE "processed_events", "payment_outbox" RESTART IDENTITY CASCADE',
  );
}
