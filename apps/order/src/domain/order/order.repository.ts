import type { Order } from '@order/domain/order/order';

export interface OrderRepository {
  /**
   * Inserts a brand-new aggregate together with its items. Called once, at
   * placement, inside the same transaction as the idempotency-key claim so a
   * claimed key always has a recoverable order row.
   */
  insert(order: Order): Promise<Order>;
  /**
   * Transitions an already-persisted aggregate via an atomic conditional
   * `UPDATE ... WHERE version = :version` that also bumps the version — the
   * optimistic-lock guard. Throws `OrderConcurrencyConflictError` when that
   * update affects zero rows (a concurrent writer already moved the version on).
   */
  updateStatus(order: Order): Promise<Order>;
  /** Tenant-scoped lookup by id. `undefined` when no such order exists in the tenant. */
  findById(tenantId: string, id: string): Promise<Order | undefined>;
}

export const ORDER_REPOSITORY = Symbol('OrderRepository');
