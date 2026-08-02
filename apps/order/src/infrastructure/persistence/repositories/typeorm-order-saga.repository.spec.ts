import { SagaStateChangedError } from '@order/domain/shared/errors';
import type { OrderSagaOrmEntity } from '@order/infrastructure/persistence/entities/order-saga.orm-entity';
import { TypeOrmOrderSagaRepository } from '@order/infrastructure/persistence/repositories/typeorm-order-saga.repository';
import type { Repository } from 'typeorm';

/** Chainable stand-in for TypeORM's update `QueryBuilder`, returning a canned affected count. */
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

function fakeRepository(affected: number): {
  repository: Repository<OrderSagaOrmEntity>;
  queryBuilder: FakeUpdateQueryBuilder;
} {
  const queryBuilder = new FakeUpdateQueryBuilder(affected);
  const repository = {
    createQueryBuilder: () => queryBuilder,
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
