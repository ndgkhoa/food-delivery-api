import { NON_TERMINAL_SAGA_STATES } from '@order/domain/saga/stranded-saga-sweep';
import { SagaStateChangedError } from '@order/domain/shared/errors';
import type { OrderSagaOrmEntity } from '@order/infrastructure/persistence/entities/order-saga.orm-entity';
import { TypeOrmOrderSagaRepository } from '@order/infrastructure/persistence/repositories/typeorm-order-saga.repository';
import type { Repository } from 'typeorm';

class FakeUpdateQueryBuilder {
  where: (sql: string, params: Record<string, unknown>) => this;
  readonly wheres: { sql: string; params: Record<string, unknown> }[] = [];

  constructor(private readonly affected: number) {
    this.where = (sql, params) => {
      this.wheres.push({ sql, params });
      return this;
    };
  }
  update(): this {
    return this;
  }
  set(): this {
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
} {
  const queryBuilder = new FakeUpdateQueryBuilder(affected);
  const repository = {
    createQueryBuilder: () => queryBuilder,
    findOne: async () => findOneResult ?? null,
  } as unknown as Repository<OrderSagaOrmEntity>;
  return { repository, queryBuilder };
}

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
