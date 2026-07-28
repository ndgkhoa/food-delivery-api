import type { OrderSaga } from '@order/domain/saga/order-saga';

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
}

export const ORDER_SAGA_REPOSITORY = Symbol('OrderSagaRepository');
