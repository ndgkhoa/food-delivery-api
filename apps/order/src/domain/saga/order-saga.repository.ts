import type { OrderSaga, SagaState } from '@order/domain/saga/order-saga';
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
   * non-terminal sagas that have not advanced since `olderThan`, reduced to the
   * fields the sweep needs. The `updated_at` bound is pushed into the query so
   * the `(state, updated_at)` index does the work and the result set stays
   * bounded (a healthy saga advances well inside the timeout). Operational only.
   */
  findNonTerminal(olderThan: Date): Promise<StrandedSagaCandidate[]>;
  /**
   * Reconciler bookkeeping: atomically increments `attempts` and refreshes
   * `updated_at` for the saga just re-driven, GUARDED on the saga still being
   * in `expectedState` (the state `decideReconcileAction` decided the re-drive
   * command for). Throws `SagaStateChangedError` when the guard's conditional
   * `UPDATE` affects zero rows — a concurrent real reply already advanced the
   * saga since it was read, so the caller's transaction (which also holds the
   * re-drive command's outbox append) must roll back rather than commit a
   * re-drive for a saga that already moved on its own. Called inside the same
   * transaction as that outbox append (see `TransactionPort`), BEFORE it, so
   * the guard is checked before any write is staged. System-wide like
   * `findNonTerminal` — the reconciler sweep is operational, not a
   * tenant-scoped request.
   */
  recordReconcileAttempt(orderId: string, expectedState: SagaState): Promise<void>;
}

export const ORDER_SAGA_REPOSITORY = Symbol('OrderSagaRepository');
