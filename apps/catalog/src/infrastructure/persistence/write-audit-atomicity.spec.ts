import { CreateRestaurantHandler } from '@catalog/application/restaurant/commands/create-restaurant.handler';
import type { AuditEntry, AuditPort } from '@catalog/domain/shared/audit.port';
import type { OutboxEntry, OutboxWriter } from '@catalog/domain/shared/outbox.port';
import { RestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/restaurant.orm-entity';
import { TypeOrmRestaurantRepository } from '@catalog/infrastructure/persistence/repositories/typeorm-restaurant.repository';
import { TypeOrmTransactionAdapter } from '@catalog/infrastructure/persistence/transaction/typeorm-transaction.adapter';
import {
  type CatalogTestDatabase,
  startCatalogTestDatabase,
  stopCatalogTestDatabase,
  truncateCatalogTables,
} from '@catalog/testing/catalog-test-database';
import type { TenantContextPort, TenantRequestContext } from '@food-delivery-api/shared-tenancy';

describe('WriteAuditAtomicity (integration)', () => {
  let db: CatalogTestDatabase;
  let repository: TypeOrmRestaurantRepository;
  let transaction: TypeOrmTransactionAdapter;

  const tenantA = '11111111-1111-4111-8111-111111111111';

  const tenantContext: TenantContextPort = {
    run: <T>(_ctx: TenantRequestContext, work: () => T) => work(),
    getContext: () => ({ tenantId: tenantA, actor: 'test-suite', roles: [] }),
    getTenantIdOrThrow: () => tenantA,
    getActor: () => 'test-suite',
  };

  const throwingAudit: AuditPort = {
    record: async (_entry: AuditEntry) => {
      throw new Error('audit boom');
    },
  };

  const noopOutbox: OutboxWriter = {
    write: async (_entry: OutboxEntry) => {},
  };

  beforeAll(async () => {
    db = await startCatalogTestDatabase();
    repository = new TypeOrmRestaurantRepository(db.dataSource.getRepository(RestaurantOrmEntity));
    transaction = new TypeOrmTransactionAdapter(db.dataSource);
  }, 60000);

  afterAll(async () => {
    await stopCatalogTestDatabase(db);
  });

  afterEach(async () => {
    await truncateCatalogTables(db.dataSource);
  });

  it('rolls back the restaurant write when the audit record fails', async () => {
    const handler = new CreateRestaurantHandler(
      repository,
      tenantContext,
      throwingAudit,
      noopOutbox,
      transaction,
    );

    await expect(handler.execute({ name: 'Rollback Diner' })).rejects.toThrow(/audit boom/);

    const { total } = await repository.findAndCount(tenantA, { page: 1, limit: 20 });
    expect(total).toBe(0);
  });
});
