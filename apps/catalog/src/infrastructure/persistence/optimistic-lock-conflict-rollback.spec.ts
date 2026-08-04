import { UpdateRestaurantHandler } from '@catalog/application/restaurant/commands/update-restaurant.handler';
import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import { Restaurant } from '@catalog/domain/restaurant/restaurant';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import { ConcurrencyConflictError } from '@catalog/domain/shared/errors';
import { TypeOrmAuditAdapter } from '@catalog/infrastructure/audit/typeorm-audit.adapter';
import { TypeOrmOutboxAdapter } from '@catalog/infrastructure/outbox/typeorm-outbox.adapter';
import { AuditLogOrmEntity } from '@catalog/infrastructure/persistence/entities/audit-log.orm-entity';
import { OutboxOrmEntity } from '@catalog/infrastructure/persistence/entities/outbox.orm-entity';
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

describe('optimistic-lock conflict rollback (integration)', () => {
  let db: CatalogTestDatabase;
  let repository: TypeOrmRestaurantRepository;
  let transaction: TypeOrmTransactionAdapter;
  let auditAdapter: TypeOrmAuditAdapter;
  let outboxAdapter: TypeOrmOutboxAdapter;
  let getRestaurant: GetRestaurantHandler;
  let updateRestaurant: UpdateRestaurantHandler;

  const tenantA = '11111111-1111-4111-8111-111111111111';

  const tenantContext: TenantContextPort = {
    run: <T>(_ctx: TenantRequestContext, work: () => T) => work(),
    getContext: () => ({ tenantId: tenantA, actor: 'test-suite', roles: [] }),
    getTenantIdOrThrow: () => tenantA,
    getActor: () => 'test-suite',
  };

  beforeAll(async () => {
    db = await startCatalogTestDatabase();
    repository = new TypeOrmRestaurantRepository(db.dataSource.getRepository(RestaurantOrmEntity));
    transaction = new TypeOrmTransactionAdapter(db.dataSource);
    auditAdapter = new TypeOrmAuditAdapter(
      db.dataSource.getRepository(AuditLogOrmEntity),
      tenantContext,
    );
    outboxAdapter = new TypeOrmOutboxAdapter(
      db.dataSource.getRepository(OutboxOrmEntity),
      tenantContext,
    );
    getRestaurant = new GetRestaurantHandler(repository, tenantContext);
    updateRestaurant = new UpdateRestaurantHandler(
      repository,
      auditAdapter,
      outboxAdapter,
      transaction,
      getRestaurant,
    );
  }, 60000);

  afterAll(async () => {
    await stopCatalogTestDatabase(db);
  });

  afterEach(async () => {
    await truncateCatalogTables(db.dataSource);
  });

  it('rejects a stale If-Match before the transaction and leaves no audit/outbox row', async () => {
    const restaurant = await repository.save(
      Restaurant.create({ id: crypto.randomUUID(), tenantId: tenantA, name: 'Pho House' }),
    );

    const winner = await updateRestaurant.execute(restaurant.id, { name: 'Winner' });
    expect(winner.version).toBe(2);

    await expect(
      updateRestaurant.execute(restaurant.id, { name: 'Loser', expectedVersion: 1 }),
    ).rejects.toThrow(ConcurrencyConflictError);

    const finalRow = await repository.findById(restaurant.id, tenantA);
    expect(finalRow?.name).toBe('Winner');
    expect(finalRow?.version).toBe(2);

    const auditRows = await db.dataSource.query(
      'SELECT * FROM "audit_log" WHERE entity_id = $1 AND action = $2',
      [restaurant.id, 'UPDATE'],
    );
    expect(auditRows).toHaveLength(1);

    const outboxRows = await db.dataSource.query(
      'SELECT * FROM "outbox" WHERE aggregateid = $1 AND type = $2',
      [restaurant.id, 'RestaurantUpdated'],
    );
    expect(outboxRows).toHaveLength(1);
  });

  it('rolls back the audit row when the save-time version guard rejects a conflicting write', async () => {
    const restaurant = await repository.save(
      Restaurant.create({ id: crypto.randomUUID(), tenantId: tenantA, name: 'Pho House' }),
    );

    const firstView = await repository.findById(restaurant.id, tenantA);
    const secondView = await repository.findById(restaurant.id, tenantA);
    if (!firstView || !secondView) {
      throw new Error('expected both loads to find the seeded restaurant');
    }

    await repository.updateVersioned(firstView.update({ name: 'Winner' }));

    await expect(
      transaction.runInTransaction(async () => {
        const saved = await repository.updateVersioned(secondView.update({ name: 'Loser' }));
        await auditAdapter.record({
          action: AuditAction.UPDATE,
          entity: 'restaurant',
          entityId: saved.id,
          before: secondView.toSnapshot(),
          after: saved.toSnapshot(),
        });
        return saved;
      }),
    ).rejects.toThrow(ConcurrencyConflictError);

    const auditRows = await db.dataSource.query(
      'SELECT * FROM "audit_log" WHERE entity_id = $1 AND action = $2',
      [restaurant.id, 'UPDATE'],
    );
    expect(auditRows).toHaveLength(0);

    const finalRow = await repository.findById(restaurant.id, tenantA);
    expect(finalRow?.name).toBe('Winner');
  });
});
