import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OrderSaga, type SagaState } from '@order/domain/saga/order-saga';
import type { OrderSagaRepository } from '@order/domain/saga/order-saga.repository';
import {
  NON_TERMINAL_SAGA_STATES,
  type StrandedSagaCandidate,
} from '@order/domain/saga/stranded-saga-sweep';
import { SagaConcurrencyConflictError, SagaStateChangedError } from '@order/domain/shared/errors';
import { OrderSagaOrmEntity } from '@order/infrastructure/persistence/entities/order-saga.orm-entity';
import { getTransactionalEntityManager } from '@order/infrastructure/persistence/transaction/transactional-entity-manager';
import type { Repository } from 'typeorm';

function toDomain(row: OrderSagaOrmEntity): OrderSaga {
  return OrderSaga.reconstitute({
    orderId: row.orderId,
    tenantId: row.tenantId,
    state: row.state as SagaState,
    correlationId: row.correlationId,
    lastEventId: row.lastEventId,
    version: row.version,
    attempts: row.attempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

@Injectable()
export class TypeOrmOrderSagaRepository implements OrderSagaRepository {
  constructor(
    @InjectRepository(OrderSagaOrmEntity)
    private readonly ormRepository: Repository<OrderSagaOrmEntity>,
  ) {}

  /** Enlists in the active transaction when one is open, else the default connection. */
  private get repository(): Repository<OrderSagaOrmEntity> {
    return getTransactionalEntityManager()?.getRepository(OrderSagaOrmEntity) ?? this.ormRepository;
  }

  async insert(saga: OrderSaga): Promise<void> {
    await this.repository.insert({
      orderId: saga.orderId,
      tenantId: saga.tenantId,
      state: saga.state,
      correlationId: saga.correlationId,
      lastEventId: saga.lastEventId,
      version: saga.version,
      attempts: saga.attempts,
    });
  }

  async findByOrderId(tenantId: string, orderId: string): Promise<OrderSaga | undefined> {
    const row = await this.repository.findOne({ where: { orderId, tenantId } });
    return row ? toDomain(row) : undefined;
  }

  /**
   * Optimistic-lock transition: an atomic conditional `UPDATE ... WHERE
   * order_id = :orderId AND version = :version` that also bumps the version.
   * Zero affected rows means a concurrent reply already advanced the saga since
   * this instance was loaded — a real conflict the caller abandons.
   */
  async transition(saga: OrderSaga): Promise<OrderSaga> {
    const result = await this.repository
      .createQueryBuilder()
      .update(OrderSagaOrmEntity)
      .set({
        state: saga.state,
        lastEventId: saga.lastEventId,
        version: () => 'version + 1',
        updatedAt: () => 'now()',
      })
      .where('order_id = :orderId AND tenant_id = :tenantId AND version = :version', {
        orderId: saga.orderId,
        tenantId: saga.tenantId,
        version: saga.version,
      })
      .execute();

    if ((result.affected ?? 0) === 0) {
      throw new SagaConcurrencyConflictError(saga.orderId);
    }

    return OrderSaga.reconstitute({
      orderId: saga.orderId,
      tenantId: saga.tenantId,
      state: saga.state,
      correlationId: saga.correlationId,
      lastEventId: saga.lastEventId,
      version: saga.version + 1,
      attempts: saga.attempts,
      createdAt: saga.createdAt,
      updatedAt: new Date(),
    });
  }

  /**
   * Reconciler bookkeeping — enlists in the caller's active transaction (the
   * same one the re-drive command's outbox append runs in) via the same
   * transactional-entity-manager getter every other write here uses. Guards
   * the `UPDATE` on the saga STILL being in `expectedState`: a concurrent real
   * reply that already advanced/terminated the saga makes this conditional
   * update affect zero rows, which throws `SagaStateChangedError` so the
   * caller's transaction rolls back instead of committing a re-drive for a
   * saga that already moved on its own.
   */
  async recordReconcileAttempt(orderId: string, expectedState: SagaState): Promise<void> {
    const result = await this.repository
      .createQueryBuilder()
      .update(OrderSagaOrmEntity)
      .set({ attempts: () => 'attempts + 1', updatedAt: () => 'now()' })
      .where('order_id = :orderId AND state = :expectedState', { orderId, expectedState })
      .execute();

    if ((result.affected ?? 0) === 0) {
      throw new SagaStateChangedError(orderId, expectedState);
    }
  }

  /**
   * DLQ-replay tool: a single conditional `UPDATE ... WHERE tenant_id AND
   * order_id AND state IN (non-terminal)` resets `attempts` to 0 so the next
   * reaper sweep re-drives the saga fresh. Deliberately does NOT touch
   * `updated_at`: the reaper selects stranded rows by `updated_at < now -
   * timeout`, and an escalated saga is only ever swept because its
   * `updated_at` is already stale — bumping it here would make the row freshly
   * idle and skip it for a full timeout window, so the replay would silently
   * not take effect until then. Leaving `updated_at` untouched keeps the saga
   * immediately sweep-eligible, so the very next tick re-drives it. Zero
   * affected rows is ambiguous (missing row vs. terminal row), so a follow-up
   * tenant-scoped lookup disambiguates the two outcomes for the caller.
   */
  async resetReconcileAttempts(
    tenantId: string,
    orderId: string,
  ): Promise<'reset' | 'terminal' | 'not_found'> {
    const result = await this.repository
      .createQueryBuilder()
      .update(OrderSagaOrmEntity)
      .set({ attempts: 0 })
      .where('order_id = :orderId AND tenant_id = :tenantId AND state IN (:...states)', {
        orderId,
        tenantId,
        states: [...NON_TERMINAL_SAGA_STATES],
      })
      .execute();

    if ((result.affected ?? 0) > 0) {
      return 'reset';
    }

    const existing = await this.findByOrderId(tenantId, orderId);
    return existing ? 'terminal' : 'not_found';
  }

  async findNonTerminal(olderThan: Date): Promise<StrandedSagaCandidate[]> {
    const rows = await this.ormRepository
      .createQueryBuilder('saga')
      .select(['saga.order_id AS order_id', 'saga.tenant_id AS tenant_id'])
      .addSelect('saga.state', 'state')
      .addSelect('saga.updated_at', 'updated_at')
      .where('saga.state IN (:...states)', { states: [...NON_TERMINAL_SAGA_STATES] })
      .andWhere('saga.updated_at < :olderThan', { olderThan })
      .getRawMany<{ order_id: string; tenant_id: string; state: string; updated_at: Date }>();

    return rows.map((row) => ({
      orderId: row.order_id,
      tenantId: row.tenant_id,
      state: row.state as SagaState,
      updatedAt: new Date(row.updated_at),
    }));
  }
}
