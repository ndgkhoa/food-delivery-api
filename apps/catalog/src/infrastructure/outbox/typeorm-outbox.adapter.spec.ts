import type { OutboxEntry } from '@catalog/domain/shared/outbox.port';
import { TypeOrmOutboxAdapter } from '@catalog/infrastructure/outbox/typeorm-outbox.adapter';
import { OutboxOrmEntity } from '@catalog/infrastructure/persistence/entities/outbox.orm-entity';
import { runWithEntityManager } from '@catalog/infrastructure/persistence/transaction/transactional-entity-manager';
import type { TenantContextPort, TenantRequestContext } from '@food-delivery-api/shared-tenancy';
import type { EntityManager, Repository } from 'typeorm';

class FakeOutboxRepository {
  readonly saved: OutboxOrmEntity[] = [];
  create(row: Partial<OutboxOrmEntity>): OutboxOrmEntity {
    return row as OutboxOrmEntity;
  }
  async save(row: OutboxOrmEntity): Promise<OutboxOrmEntity> {
    this.saved.push(row);
    return row;
  }
}

const tenantId = '11111111-1111-4111-8111-111111111111';
const tenantContext: TenantContextPort = {
  run: <T>(_ctx: TenantRequestContext, work: () => T) => work(),
  getContext: () => ({ tenantId, actor: 'system', roles: [] }),
  getTenantIdOrThrow: () => tenantId,
  getActor: () => 'system',
};

const entry: OutboxEntry = {
  aggregateType: 'catalog',
  aggregateId: '22222222-2222-4222-8222-222222222222',
  type: 'RestaurantCreated',
  payload: { id: '22222222-2222-4222-8222-222222222222', name: 'Pho House' },
};

describe('TypeOrmOutboxAdapter', () => {
  it('stamps tenant from context and mints a correlation id, ignoring the entry for tenant', async () => {
    const fallback = new FakeOutboxRepository();
    const adapter = new TypeOrmOutboxAdapter(
      fallback as unknown as Repository<OutboxOrmEntity>,
      tenantContext,
    );

    await adapter.write(entry);

    expect(fallback.saved).toHaveLength(1);
    const row = fallback.saved[0];
    expect(row.tenantId).toBe(tenantId);
    expect(row.aggregatetype).toBe('catalog');
    expect(row.aggregateid).toBe(entry.aggregateId);
    expect(row.type).toBe('RestaurantCreated');
    expect(row.correlationid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('enlists the active transactional entity manager instead of the default repository', async () => {
    const fallback = new FakeOutboxRepository();
    const txRepo = new FakeOutboxRepository();
    const manager = {
      getRepository: () => txRepo as unknown as Repository<OutboxOrmEntity>,
    } as unknown as EntityManager;

    const adapter = new TypeOrmOutboxAdapter(
      fallback as unknown as Repository<OutboxOrmEntity>,
      tenantContext,
    );

    await runWithEntityManager(manager, () => adapter.write(entry));

    expect(txRepo.saved).toHaveLength(1);
    expect(fallback.saved).toHaveLength(0);
  });
});
