import type { TenantContextPort, TenantRequestContext } from '@food-delivery-api/shared-tenancy';
import { OrderSaga, type SagaState } from '@order/domain/saga/order-saga';
import { SagaStateChangedError } from '@order/domain/shared/errors';
import {
  buildOrder,
  DEFAULT_CORRELATION_ID,
  FakeOrderRepository,
  FakeOutboxWriter,
  FakeSagaRepository,
  FakeTransaction,
  TENANT_ID,
} from '@order/testing/saga-reply-test-doubles';
import type { DataSource, QueryRunner } from 'typeorm';
import { SagaReaperProvider } from './saga-reaper.provider';

const TIMEOUT_MS = 60_000;
const INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 10;

function reaperConfig(maxAttempts = MAX_ATTEMPTS) {
  const values: Record<string, number> = {
    SAGA_REAPER_TIMEOUT_MS: TIMEOUT_MS,
    SAGA_REAPER_INTERVAL_MS: INTERVAL_MS,
    SAGA_RECONCILER_MAX_ATTEMPTS: maxAttempts,
  };
  return {
    getOrThrow: <T>(key: string): T => values[key] as unknown as T,
    get: <T>(_key: string): T => 'test' as unknown as T,
  };
}

function fakeDataSource(tryLockResult: boolean): DataSource {
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT pg_try_advisory_lock')) {
        return [{ pg_try_advisory_lock: tryLockResult }];
      }
      return [];
    }),
    release: jest.fn().mockResolvedValue(undefined),
  } as unknown as QueryRunner;

  return {
    createQueryRunner: jest.fn().mockReturnValue(queryRunner),
  } as unknown as DataSource;
}

class FakeTenantContext implements TenantContextPort {
  readonly runs: TenantRequestContext[] = [];

  run<T>(context: TenantRequestContext, callback: () => T): T {
    this.runs.push(context);
    return callback();
  }

  getContext(): TenantRequestContext | undefined {
    return undefined;
  }

  getTenantIdOrThrow(): string {
    throw new Error('not used by the reaper — the outbox fake does not consult it');
  }

  getActor(): string {
    return 'system';
  }
}

function sagaAged(
  orderId: string,
  ageMs: number,
  state: SagaState = 'STARTED',
  attempts = 0,
): OrderSaga {
  const updatedAt = new Date(Date.now() - ageMs);
  return OrderSaga.reconstitute({
    orderId,
    tenantId: TENANT_ID,
    state,
    correlationId: DEFAULT_CORRELATION_ID,
    lastEventId: null,
    version: 1,
    attempts,
    createdAt: updatedAt,
    updatedAt,
  });
}

function buildReaper(options: {
  sagaRepo: FakeSagaRepository;
  orderRepo: FakeOrderRepository;
  outbox: FakeOutboxWriter;
  tryLockResult?: boolean;
  maxAttempts?: number;
}) {
  return new SagaReaperProvider(
    options.sagaRepo,
    options.orderRepo,
    options.outbox,
    new FakeTransaction(),
    new FakeTenantContext(),
    fakeDataSource(options.tryLockResult ?? true),
    reaperConfig(options.maxAttempts) as never,
  );
}

describe('SagaReaperProvider.sweep', () => {
  it('reports only the non-terminal sagas idle past the timeout', async () => {
    const sagaRepo = new FakeSagaRepository();
    sagaRepo.seed(sagaAged('stale', TIMEOUT_MS + 5_000));
    sagaRepo.seed(sagaAged('fresh', TIMEOUT_MS - 5_000));
    sagaRepo.seed(
      OrderSaga.reconstitute({
        orderId: 'done',
        tenantId: TENANT_ID,
        state: 'COMPLETED',
        correlationId: null,
        lastEventId: null,
        version: 3,
        attempts: 0,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
    );
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildOrder('stale', 'PENDING'));

    const reaper = buildReaper({ sagaRepo, orderRepo, outbox: new FakeOutboxWriter() });

    await expect(reaper.sweep()).resolves.toBe(1);
  });

  it('re-drives a STARTED saga by re-emitting ReserveStock and bumps attempts', async () => {
    const sagaRepo = new FakeSagaRepository();
    sagaRepo.seed(sagaAged('order-1', TIMEOUT_MS + 1_000, 'STARTED', 2));
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildOrder('order-1', 'PENDING'));
    const outbox = new FakeOutboxWriter();

    const reaper = buildReaper({ sagaRepo, orderRepo, outbox });
    await reaper.sweep();

    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]).toMatchObject({ aggregateId: 'order-1', eventType: 'ReserveStock' });
    expect(sagaRepo.rows.get('order-1')?.attempts).toBe(3);
  });

  it('re-drives a STOCK_RESERVED saga by re-emitting ChargePayment', async () => {
    const sagaRepo = new FakeSagaRepository();
    sagaRepo.seed(sagaAged('order-2', TIMEOUT_MS + 1_000, 'STOCK_RESERVED'));
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildOrder('order-2', 'RESERVED'));
    const outbox = new FakeOutboxWriter();

    const reaper = buildReaper({ sagaRepo, orderRepo, outbox });
    await reaper.sweep();

    expect(outbox.entries[0]).toMatchObject({ aggregateId: 'order-2', eventType: 'ChargePayment' });
    expect(sagaRepo.rows.get('order-2')?.attempts).toBe(1);
  });

  it('re-drives a COMPENSATING saga by re-emitting ReleaseStock', async () => {
    const sagaRepo = new FakeSagaRepository();
    sagaRepo.seed(sagaAged('order-3', TIMEOUT_MS + 1_000, 'COMPENSATING'));
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildOrder('order-3', 'RESERVED'));
    const outbox = new FakeOutboxWriter();

    const reaper = buildReaper({ sagaRepo, orderRepo, outbox });
    await reaper.sweep();

    expect(outbox.entries[0]).toMatchObject({ aggregateId: 'order-3', eventType: 'ReleaseStock' });
  });

  it('escalates instead of re-driving once attempts reaches the cap, and never bumps attempts further', async () => {
    const sagaRepo = new FakeSagaRepository();
    sagaRepo.seed(sagaAged('order-4', TIMEOUT_MS + 1_000, 'STARTED', MAX_ATTEMPTS));
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildOrder('order-4', 'PENDING'));
    const outbox = new FakeOutboxWriter();

    const reaper = buildReaper({ sagaRepo, orderRepo, outbox, maxAttempts: MAX_ATTEMPTS });
    const stranded = await reaper.sweep();

    expect(stranded).toBe(1);
    expect(outbox.entries).toHaveLength(0);
    expect(sagaRepo.rows.get('order-4')?.attempts).toBe(MAX_ATTEMPTS);
  });

  it('skips the sweep and returns 0 when another replica holds the advisory lock', async () => {
    const sagaRepo = new FakeSagaRepository();
    sagaRepo.seed(sagaAged('order-5', TIMEOUT_MS + 1_000));
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildOrder('order-5', 'PENDING'));
    const outbox = new FakeOutboxWriter();

    const reaper = buildReaper({ sagaRepo, orderRepo, outbox, tryLockResult: false });

    await expect(reaper.sweep()).resolves.toBe(0);
    expect(outbox.entries).toHaveLength(0);
  });

  it('never throws when the saga repository errors, and returns 0', async () => {
    const sagaRepo = new FakeSagaRepository();
    jest.spyOn(sagaRepo, 'findNonTerminal').mockRejectedValue(new Error('connection reset'));
    const outbox = new FakeOutboxWriter();

    const reaper = buildReaper({ sagaRepo, orderRepo: new FakeOrderRepository(), outbox });

    await expect(reaper.sweep()).resolves.toBe(0);
  });

  it('rolls back the re-drive when a concurrent reply changes the saga state first, without throwing or bumping attempts', async () => {
    const sagaRepo = new FakeSagaRepository();
    sagaRepo.seed(sagaAged('order-7', TIMEOUT_MS + 1_000, 'STARTED', 1));
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildOrder('order-7', 'PENDING'));
    const outbox = new FakeOutboxWriter();
    jest
      .spyOn(sagaRepo, 'recordReconcileAttempt')
      .mockRejectedValue(new SagaStateChangedError('order-7', 'STARTED'));

    const reaper = buildReaper({ sagaRepo, orderRepo, outbox });

    await expect(reaper.sweep()).resolves.toBe(1);
    expect(outbox.entries).toHaveLength(0);
    expect(sagaRepo.rows.get('order-7')?.attempts).toBe(1);
  });

  it('isolates one bad candidate so the rest of the sweep still recovers', async () => {
    const sagaRepo = new FakeSagaRepository();
    sagaRepo.seed(sagaAged('missing-order', TIMEOUT_MS + 1_000));
    sagaRepo.seed(sagaAged('order-6', TIMEOUT_MS + 1_000));
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildOrder('order-6', 'PENDING'));
    const outbox = new FakeOutboxWriter();

    const reaper = buildReaper({ sagaRepo, orderRepo, outbox });
    const stranded = await reaper.sweep();

    expect(stranded).toBe(2);
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]?.aggregateId).toBe('order-6');
  });
});
