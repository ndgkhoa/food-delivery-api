import type { OrderSaga } from '@order/domain/saga/order-saga';
import type { StrandedSagaCandidate } from '@order/domain/saga/stranded-saga-sweep';

export interface OrderSagaRepository {
  /**
   * Inserts a brand-new STARTED saga, called inside the same transaction as the
   * order insert + first outbox command so the whole placement commits atomically.
   */
  insert(saga: OrderSaga): Promise<void>;
  /** Tenant-scoped lookup by order id. `undefined` when no saga row exists. */
  findByOrderId(tenantId: string, orderId: string): Promise<OrderSaga | undefined>;
  /**
   * Applies a transition via an atomic conditional `UPDATE ... WHERE order_id =
   * :orderId AND version = :version` that also bumps the version — the
   * optimistic-lock guard. Throws `SagaConcurrencyConflictError` when that
   * update affects zero rows (a concurrent reply already advanced the saga).
   */
  transition(saga: OrderSaga): Promise<OrderSaga>;
  /**
   * System-wide (not tenant-scoped) sweep for the stranded-saga reaper: returns
   * every saga still in a non-terminal state, reduced to the fields the sweep
   * needs. Backed by the `(state, updated_at)` index. Operational use only.
   */
  findNonTerminal(): Promise<StrandedSagaCandidate[]>;
}

export const ORDER_SAGA_REPOSITORY = Symbol('OrderSagaRepository');
