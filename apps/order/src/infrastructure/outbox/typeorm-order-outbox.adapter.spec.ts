import { captureActiveTraceContext } from '@food-delivery-api/shared-observability';
import type { TenantContextPort, TenantRequestContext } from '@food-delivery-api/shared-tenancy';
import type { OutboxCommandEntry } from '@order/domain/shared/outbox.port';
import { TypeOrmOrderOutboxAdapter } from '@order/infrastructure/outbox/typeorm-order-outbox.adapter';
import type { OrderOutboxOrmEntity } from '@order/infrastructure/persistence/entities/order-outbox.orm-entity';
import { runWithEntityManager } from '@order/infrastructure/persistence/transaction/transactional-entity-manager';
import type { DataSource, EntityManager, QueryRunner, Repository } from 'typeorm';

jest.mock('@food-delivery-api/shared-observability', () => ({
  captureActiveTraceContext: jest.fn(),
}));

const mockCaptureActiveTraceContext = captureActiveTraceContext as jest.MockedFunction<
  typeof captureActiveTraceContext
>;

class FakeOutboxRepository {
  readonly saved: OrderOutboxOrmEntity[] = [];
  incrementCalls: { conditions: unknown; column: unknown; by: unknown }[] = [];
  updateCalls: { criteria: unknown; partial: unknown }[] = [];
  create(row: Partial<OrderOutboxOrmEntity>): OrderOutboxOrmEntity {
    return row as OrderOutboxOrmEntity;
  }
  async save(row: OrderOutboxOrmEntity): Promise<OrderOutboxOrmEntity> {
    this.saved.push(row);
    return row;
  }
  async increment(conditions: unknown, column: unknown, by: unknown): Promise<void> {
    this.incrementCalls.push({ conditions, column, by });
  }
  async update(criteria: unknown, partial: unknown): Promise<void> {
    this.updateCalls.push({ criteria, partial });
  }
}

class FakeQueryBuilder {
  constructor(private readonly rows: Record<string, unknown>[]) {}
  select(): this {
    return this;
  }
  where(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  setLock(): this {
    return this;
  }
  setOnLocked(): this {
    return this;
  }
  async getRawMany<T>(): Promise<T[]> {
    return this.rows as T[];
  }
}

function fakeDataSource(rows: Record<string, unknown>[]): DataSource {
  const manager = {
    getRepository: () => ({ createQueryBuilder: () => new FakeQueryBuilder(rows) }),
  } as unknown as EntityManager;
  return {
    transaction: async (work: (manager: EntityManager) => unknown) => work(manager),
  } as unknown as DataSource;
}

function fakeLockDataSource(tryLockResult: boolean): {
  dataSource: DataSource;
  queryRunner: QueryRunner;
} {
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(async (sql: string) =>
      sql.startsWith('SELECT pg_try_advisory_lock')
        ? [{ pg_try_advisory_lock: tryLockResult }]
        : [],
    ),
    release: jest.fn().mockResolvedValue(undefined),
  } as unknown as QueryRunner;
  const dataSource = {
    createQueryRunner: jest.fn().mockReturnValue(queryRunner),
  } as unknown as DataSource;
  return { dataSource, queryRunner };
}

const tenantId = '11111111-1111-4111-8111-111111111111';
const tenantContext: TenantContextPort = {
  run: <T>(_ctx: TenantRequestContext, work: () => T) => work(),
  getContext: () => ({ tenantId, actor: 'system', roles: [] }),
  getTenantIdOrThrow: () => tenantId,
  getActor: () => 'system',
};

const entry: OutboxCommandEntry = {
  aggregateId: '22222222-2222-4222-8222-222222222222',
  topic: 'order.commands',
  eventType: 'ReserveStock',
  payload: { orderId: '22222222-2222-4222-8222-222222222222' },
};

describe('TypeOrmOrderOutboxAdapter', () => {
  beforeEach(() => {
    mockCaptureActiveTraceContext.mockReset();
  });

  describe('append', () => {
    it('persists the captured traceparent when a trace context is active', async () => {
      mockCaptureActiveTraceContext.mockReturnValue({
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      });
      const fallback = new FakeOutboxRepository();
      const adapter = new TypeOrmOrderOutboxAdapter(
        fallback as unknown as Repository<OrderOutboxOrmEntity>,
        fakeDataSource([]),
        tenantContext,
      );

      await adapter.append(entry);

      expect(fallback.saved).toHaveLength(1);
      expect(fallback.saved[0].traceParent).toBe(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      );
    });

    it('persists a null traceParent when no trace context is active', async () => {
      mockCaptureActiveTraceContext.mockReturnValue({});
      const fallback = new FakeOutboxRepository();
      const adapter = new TypeOrmOrderOutboxAdapter(
        fallback as unknown as Repository<OrderOutboxOrmEntity>,
        fakeDataSource([]),
        tenantContext,
      );

      await adapter.append(entry);

      expect(fallback.saved[0].traceParent).toBeNull();
    });

    it('enlists the active transactional entity manager instead of the default repository', async () => {
      mockCaptureActiveTraceContext.mockReturnValue({});
      const fallback = new FakeOutboxRepository();
      const txRepo = new FakeOutboxRepository();
      const manager = {
        getRepository: () => txRepo as unknown as Repository<OrderOutboxOrmEntity>,
      } as unknown as EntityManager;

      const adapter = new TypeOrmOrderOutboxAdapter(
        fallback as unknown as Repository<OrderOutboxOrmEntity>,
        fakeDataSource([]),
        tenantContext,
      );

      await runWithEntityManager(manager, () => adapter.append(entry));

      expect(txRepo.saved).toHaveLength(1);
      expect(fallback.saved).toHaveLength(0);
    });
  });

  describe('incrementAttempts', () => {
    it('does nothing when given an empty id list', async () => {
      const fallback = new FakeOutboxRepository();
      const adapter = new TypeOrmOrderOutboxAdapter(
        fallback as unknown as Repository<OrderOutboxOrmEntity>,
        fakeDataSource([]),
        tenantContext,
      );

      await adapter.incrementAttempts([]);

      expect(fallback.incrementCalls).toHaveLength(0);
    });

    it('increments the attempts column for the given ids', async () => {
      const fallback = new FakeOutboxRepository();
      const adapter = new TypeOrmOrderOutboxAdapter(
        fallback as unknown as Repository<OrderOutboxOrmEntity>,
        fakeDataSource([]),
        tenantContext,
      );

      await adapter.incrementAttempts(['id-1', 'id-2']);

      expect(fallback.incrementCalls).toHaveLength(1);
      expect(fallback.incrementCalls[0].column).toBe('attempts');
      expect(fallback.incrementCalls[0].by).toBe(1);
    });
  });

  describe('markPublished', () => {
    it('does nothing when given an empty id list', async () => {
      const fallback = new FakeOutboxRepository();
      const adapter = new TypeOrmOrderOutboxAdapter(
        fallback as unknown as Repository<OrderOutboxOrmEntity>,
        fakeDataSource([]),
        tenantContext,
      );

      await adapter.markPublished([]);

      expect(fallback.updateCalls).toHaveLength(0);
    });

    it('sets publishedAt for the given ids', async () => {
      const fallback = new FakeOutboxRepository();
      const adapter = new TypeOrmOrderOutboxAdapter(
        fallback as unknown as Repository<OrderOutboxOrmEntity>,
        fakeDataSource([]),
        tenantContext,
      );

      await adapter.markPublished(['id-1']);

      expect(fallback.updateCalls).toHaveLength(1);
      expect(fallback.updateCalls[0].partial).toMatchObject({ publishedAt: expect.any(Date) });
    });
  });

  describe('fetchUnpublished', () => {
    const baseRow = {
      id: '33333333-3333-4333-8333-333333333333',
      aggregate_id: entry.aggregateId,
      topic: entry.topic,
      event_type: entry.eventType,
      payload: entry.payload,
      tenant_id: tenantId,
      correlation_id: '44444444-4444-4444-8444-444444444444',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    };

    it('puts the persisted traceparent into the mapped headers', async () => {
      mockCaptureActiveTraceContext.mockReturnValue({});
      const adapter = new TypeOrmOrderOutboxAdapter(
        new FakeOutboxRepository() as unknown as Repository<OrderOutboxOrmEntity>,
        fakeDataSource([
          { ...baseRow, trace_parent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' },
        ]),
        tenantContext,
      );

      const [record] = await adapter.fetchUnpublished(10);

      expect(record.headers.traceparent).toBe(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      );
    });

    it('omits the traceparent header when the persisted column is null', async () => {
      mockCaptureActiveTraceContext.mockReturnValue({});
      const adapter = new TypeOrmOrderOutboxAdapter(
        new FakeOutboxRepository() as unknown as Repository<OrderOutboxOrmEntity>,
        fakeDataSource([{ ...baseRow, trace_parent: null }]),
        tenantContext,
      );

      const [record] = await adapter.fetchUnpublished(10);

      expect(record.headers.traceparent).toBeUndefined();
    });
  });

  describe('runExclusively', () => {
    it('runs the drain and reports ran:true + its result when the lock is won', async () => {
      const { dataSource, queryRunner } = fakeLockDataSource(true);
      const adapter = new TypeOrmOrderOutboxAdapter(
        new FakeOutboxRepository() as unknown as Repository<OrderOutboxOrmEntity>,
        dataSource,
        tenantContext,
      );
      const drain = jest.fn().mockResolvedValue(3);

      const outcome = await adapter.runExclusively(drain);

      expect(outcome).toEqual({ ran: true, result: 3 });
      expect(drain).toHaveBeenCalledTimes(1);
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('skips the drain and reports ran:false when another replica holds the lock', async () => {
      const { dataSource } = fakeLockDataSource(false);
      const adapter = new TypeOrmOrderOutboxAdapter(
        new FakeOutboxRepository() as unknown as Repository<OrderOutboxOrmEntity>,
        dataSource,
        tenantContext,
      );
      const drain = jest.fn();

      const outcome = await adapter.runExclusively(drain);

      expect(outcome).toEqual({ ran: false });
      expect(drain).not.toHaveBeenCalled();
    });
  });
});
