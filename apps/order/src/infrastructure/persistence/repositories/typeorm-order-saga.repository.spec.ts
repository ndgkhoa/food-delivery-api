import { OrderSaga } from '@order/domain/saga/order-saga';
import { NON_TERMINAL_SAGA_STATES } from '@order/domain/saga/stranded-saga-sweep';
import { SagaConcurrencyConflictError, SagaStateChangedError } from '@order/domain/shared/errors';
import type { OrderSagaOrmEntity } from '@order/infrastructure/persistence/entities/order-saga.orm-entity';
import { TypeOrmOrderSagaRepository } from '@order/infrastructure/persistence/repositories/typeorm-order-saga.repository';
import type { Repository } from 'typeorm';

type SetValue = string | number | (() => string);

class FakeUpdateQueryBuilder {
  where: (sql: string, params: Record<string, unknown>) => this;
  readonly wheres: { sql: string; params: Record<string, unknown> }[] = [];
  setArgs: Record<string, SetValue> = {};

  constructor(private readonly affected: number) {
    this.where = (sql, params) => {
      this.wheres.push({ sql, params });
      return this;
    };
  }
  update(): this {
    return this;
  }
  set(values: Record<string, SetValue>): this {
    this.setArgs = values;
    return this;
  }
  async execute(): Promise<{ affected: number }> {
    return { affected: this.affected };
  }
}

function fakeRepository(
  affected: number,
  findOneResult?: Partial<OrderSagaOrmEntity>,
): {
  repository: Repository<OrderSagaOrmEntity>;
  queryBuilder: FakeUpdateQueryBuilder;
  insertCalls: Partial<OrderSagaOrmEntity>[];
} {
  const queryBuilder = new FakeUpdateQueryBuilder(affected);
  const insertCalls: Partial<OrderSagaOrmEntity>[] = [];
  const repository = {
    createQueryBuilder: () => queryBuilder,
    findOne: async () => findOneResult ?? null,
    insert: async (row: Partial<OrderSagaOrmEntity>) => {
      insertCalls.push(row);
    },
  } as unknown as Repository<OrderSagaOrmEntity>;
  return { repository, queryBuilder, insertCalls };
}

function buildSaga(): OrderSaga {
  return OrderSaga.reconstitute({
    orderId: 'order-1',
    tenantId: 'tenant-1',
    state: 'STARTED',
    correlationId: 'correlation-1',
    lastEventId: null,
    version: 1,
    attempts: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

describe('TypeOrmOrderSagaRepository.insert', () => {
  it('persists the saga row with its starting fields', async () => {
    const { repository, insertCalls } = fakeRepository(0);
    const orderSagaRepository = new TypeOrmOrderSagaRepository(repository);

    await orderSagaRepository.insert(buildSaga());

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      orderId: 'order-1',
      tenantId: 'tenant-1',
      state: 'STARTED',
      correlationId: 'correlation-1',
      version: 1,
      attempts: 0,
    });
  });
});

describe('TypeOrmOrderSagaRepository.transition', () => {
  it('applies the guarded UPDATE (raw SQL bumps version and updatedAt) and returns the reconstituted saga', async () => {
    const { repository, queryBuilder } = fakeRepository(1);
    const orderSagaRepository = new TypeOrmOrderSagaRepository(repository);
    const saga = buildSaga();

    const result = await orderSagaRepository.transition(saga);

    expect(result.version).toBe(2);
    expect(result.state).toBe('STARTED');
    expect(queryBuilder.wheres[0]?.params).toMatchObject({
      orderId: 'order-1',
      tenantId: 'tenant-1',
      version: 1,
    });
    expect(typeof queryBuilder.setArgs.version).toBe('function');
    expect((queryBuilder.setArgs.version as () => string)()).toBe('version + 1');
    expect((queryBuilder.setArgs.updatedAt as () => string)()).toBe('now()');
  });

  it('throws SagaConcurrencyConflictError when the version-guarded UPDATE affects 0 rows', async () => {
    const { repository } = fakeRepository(0);
    const orderSagaRepository = new TypeOrmOrderSagaRepository(repository);

    await expect(orderSagaRepository.transition(buildSaga())).rejects.toThrow(
      SagaConcurrencyConflictError,
    );
  });
});

describe('TypeOrmOrderSagaRepository.findNonTerminal', () => {
  it('maps raw rows filtered to non-terminal states older than the cutoff', async () => {
    const olderThan = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2025-12-31T00:00:00.000Z');
    const wheres: { sql: string; params: Record<string, unknown> }[] = [];
    const selectQueryBuilder = {
      select: () => selectQueryBuilder,
      addSelect: () => selectQueryBuilder,
      where: (sql: string, params: Record<string, unknown>) => {
        wheres.push({ sql, params });
        return selectQueryBuilder;
      },
      andWhere: (sql: string, params: Record<string, unknown>) => {
        wheres.push({ sql, params });
        return selectQueryBuilder;
      },
      getRawMany: async () => [
        { order_id: 'order-1', tenant_id: 'tenant-1', state: 'STARTED', updated_at: updatedAt },
      ],
    };
    const repository = {
      createQueryBuilder: () => selectQueryBuilder,
    } as unknown as Repository<OrderSagaOrmEntity>;
    const orderSagaRepository = new TypeOrmOrderSagaRepository(repository);

    const result = await orderSagaRepository.findNonTerminal(olderThan);

    expect(result).toEqual([
      { orderId: 'order-1', tenantId: 'tenant-1', state: 'STARTED', updatedAt },
    ]);
    expect(wheres[0].sql).toContain('saga.state IN (:...states)');
    expect(wheres[0].params).toMatchObject({ states: [...NON_TERMINAL_SAGA_STATES] });
    expect(wheres[1].sql).toContain('saga.updated_at < :olderThan');
    expect(wheres[1].params).toMatchObject({ olderThan });
  });
});

describe('TypeOrmOrderSagaRepository.recordReconcileAttempt', () => {
  it('increments attempts when the saga is still in the expected state (guarded UPDATE affects 1 row)', async () => {
    const { repository, queryBuilder } = fakeRepository(1);
    const orderSagaRepository = new TypeOrmOrderSagaRepository(repository);

    await expect(
      orderSagaRepository.recordReconcileAttempt('order-1', 'STARTED'),
    ).resolves.toBeUndefined();

    expect(queryBuilder.wheres[0]?.params).toMatchObject({
      orderId: 'order-1',
      expectedState: 'STARTED',
    });
    expect((queryBuilder.setArgs.attempts as () => string)()).toBe('attempts + 1');
    expect((queryBuilder.setArgs.updatedAt as () => string)()).toBe('now()');
  });

  it('throws SagaStateChangedError when the saga already moved past the expected state (guarded UPDATE affects 0 rows)', async () => {
    const { repository } = fakeRepository(0);
    const orderSagaRepository = new TypeOrmOrderSagaRepository(repository);

    await expect(
      orderSagaRepository.recordReconcileAttempt('order-2', 'STOCK_RESERVED'),
    ).rejects.toThrow(SagaStateChangedError);
  });
});

describe('TypeOrmOrderSagaRepository.resetReconcileAttempts', () => {
  it('resets attempts and returns "reset" when the guarded UPDATE affects a non-terminal saga', async () => {
    const { repository, queryBuilder } = fakeRepository(1);
    const orderSagaRepository = new TypeOrmOrderSagaRepository(repository);

    await expect(orderSagaRepository.resetReconcileAttempts('tenant-1', 'order-1')).resolves.toBe(
      'reset',
    );
    expect(queryBuilder.wheres[0]?.sql).toContain('state IN (:...states)');
    expect(queryBuilder.wheres[0]?.params).toMatchObject({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      states: [...NON_TERMINAL_SAGA_STATES],
    });
  });

  it('returns "terminal" when the UPDATE affects 0 rows but the saga row exists (already terminal)', async () => {
    const { repository } = fakeRepository(0, {
      orderId: 'order-2',
      tenantId: 'tenant-1',
      state: 'COMPLETED',
    } as Partial<OrderSagaOrmEntity>);
    const orderSagaRepository = new TypeOrmOrderSagaRepository(repository);

    await expect(orderSagaRepository.resetReconcileAttempts('tenant-1', 'order-2')).resolves.toBe(
      'terminal',
    );
  });

  it('returns "not_found" when the UPDATE affects 0 rows and no saga row exists', async () => {
    const { repository } = fakeRepository(0);
    const orderSagaRepository = new TypeOrmOrderSagaRepository(repository);

    await expect(orderSagaRepository.resetReconcileAttempts('tenant-1', 'order-3')).resolves.toBe(
      'not_found',
    );
  });
});
