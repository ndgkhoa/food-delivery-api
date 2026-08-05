import { captureActiveTraceContext } from '@food-delivery-api/shared-observability';
import type { TenantContextPort, TenantRequestContext } from '@food-delivery-api/shared-tenancy';
import type { OutboxCommandEntry } from '@review/domain/shared/outbox.port';
import { TypeOrmReviewOutboxAdapter } from '@review/infrastructure/outbox/typeorm-review-outbox.adapter';
import type { ReviewOutboxOrmEntity } from '@review/infrastructure/persistence/entities/review-outbox.orm-entity';
import { runWithEntityManager } from '@review/infrastructure/persistence/transaction/transactional-entity-manager';
import {
  type DataSource,
  type EntityManager,
  In,
  IsNull,
  type QueryRunner,
  type Repository,
} from 'typeorm';

jest.mock('@food-delivery-api/shared-observability', () => ({
  captureActiveTraceContext: jest.fn(),
}));

const mockCaptureActiveTraceContext = captureActiveTraceContext as jest.MockedFunction<
  typeof captureActiveTraceContext
>;

class FakeOutboxRepository {
  readonly saved: ReviewOutboxOrmEntity[] = [];
  create(row: Partial<ReviewOutboxOrmEntity>): ReviewOutboxOrmEntity {
    return row as ReviewOutboxOrmEntity;
  }
  async save(row: ReviewOutboxOrmEntity): Promise<ReviewOutboxOrmEntity> {
    this.saved.push(row);
    return row;
  }
}

class FakeMutableOutboxRepository {
  increment = jest.fn().mockResolvedValue({ affected: 1 });
  update = jest.fn().mockResolvedValue({ affected: 1 });
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
  topic: 'review.events',
  eventType: 'RestaurantRatingChanged',
  payload: { restaurantId: '22222222-2222-4222-8222-222222222222' },
};

describe('TypeOrmReviewOutboxAdapter', () => {
  beforeEach(() => {
    mockCaptureActiveTraceContext.mockReset();
  });

  describe('append', () => {
    it('persists the captured traceparent when a trace context is active', async () => {
      mockCaptureActiveTraceContext.mockReturnValue({
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      });
      const fallback = new FakeOutboxRepository();
      const adapter = new TypeOrmReviewOutboxAdapter(
        fallback as unknown as Repository<ReviewOutboxOrmEntity>,
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
      const adapter = new TypeOrmReviewOutboxAdapter(
        fallback as unknown as Repository<ReviewOutboxOrmEntity>,
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
        getRepository: () => txRepo as unknown as Repository<ReviewOutboxOrmEntity>,
      } as unknown as EntityManager;

      const adapter = new TypeOrmReviewOutboxAdapter(
        fallback as unknown as Repository<ReviewOutboxOrmEntity>,
        fakeDataSource([]),
        tenantContext,
      );

      await runWithEntityManager(manager, () => adapter.append(entry));

      expect(txRepo.saved).toHaveLength(1);
      expect(fallback.saved).toHaveLength(0);
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
      const adapter = new TypeOrmReviewOutboxAdapter(
        new FakeOutboxRepository() as unknown as Repository<ReviewOutboxOrmEntity>,
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
      const adapter = new TypeOrmReviewOutboxAdapter(
        new FakeOutboxRepository() as unknown as Repository<ReviewOutboxOrmEntity>,
        fakeDataSource([{ ...baseRow, trace_parent: null }]),
        tenantContext,
      );

      const [record] = await adapter.fetchUnpublished(10);

      expect(record.headers.traceparent).toBeUndefined();
    });
  });

  describe('incrementAttempts', () => {
    it('skips the update call when no ids are given', async () => {
      const outboxRepository = new FakeMutableOutboxRepository();
      const adapter = new TypeOrmReviewOutboxAdapter(
        outboxRepository as unknown as Repository<ReviewOutboxOrmEntity>,
        fakeDataSource([]),
        tenantContext,
      );

      await adapter.incrementAttempts([]);

      expect(outboxRepository.increment).not.toHaveBeenCalled();
    });

    it('increments the attempts column for the given ids', async () => {
      const outboxRepository = new FakeMutableOutboxRepository();
      const adapter = new TypeOrmReviewOutboxAdapter(
        outboxRepository as unknown as Repository<ReviewOutboxOrmEntity>,
        fakeDataSource([]),
        tenantContext,
      );

      await adapter.incrementAttempts(['row-1', 'row-2']);

      expect(outboxRepository.increment).toHaveBeenCalledTimes(1);
      const [criteria, column, delta] = outboxRepository.increment.mock.calls[0];
      expect(criteria).toEqual({ id: In(['row-1', 'row-2']) });
      expect(column).toBe('attempts');
      expect(delta).toBe(1);
    });
  });

  describe('markPublished', () => {
    it('skips the update call when no ids are given', async () => {
      const outboxRepository = new FakeMutableOutboxRepository();
      const adapter = new TypeOrmReviewOutboxAdapter(
        outboxRepository as unknown as Repository<ReviewOutboxOrmEntity>,
        fakeDataSource([]),
        tenantContext,
      );

      await adapter.markPublished([]);

      expect(outboxRepository.update).not.toHaveBeenCalled();
    });

    it('marks the given ids as published', async () => {
      const outboxRepository = new FakeMutableOutboxRepository();
      const adapter = new TypeOrmReviewOutboxAdapter(
        outboxRepository as unknown as Repository<ReviewOutboxOrmEntity>,
        fakeDataSource([]),
        tenantContext,
      );

      await adapter.markPublished(['row-1']);

      expect(outboxRepository.update).toHaveBeenCalledTimes(1);
      const [criteria] = outboxRepository.update.mock.calls[0];
      expect(criteria).toEqual({ id: In(['row-1']), publishedAt: IsNull() });
    });
  });

  describe('runExclusively', () => {
    it('runs the drain and reports ran:true + its result when the lock is won', async () => {
      const { dataSource, queryRunner } = fakeLockDataSource(true);
      const adapter = new TypeOrmReviewOutboxAdapter(
        new FakeOutboxRepository() as unknown as Repository<ReviewOutboxOrmEntity>,
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
      const adapter = new TypeOrmReviewOutboxAdapter(
        new FakeOutboxRepository() as unknown as Repository<ReviewOutboxOrmEntity>,
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
