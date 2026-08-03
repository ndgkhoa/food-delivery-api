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
  /**
   * A user's most recent orders (order history), newest first, capped at
   * `limit`. Lag-tolerant by design — this is never a read of a row its own
   * caller just wrote — so implementations are free to serve it from a read
   * replica.
   */
  findRecentByTenant(tenantId: string, userId: string, limit: number): Promise<Order[]>;
}

export const ORDER_REPOSITORY = Symbol('OrderRepository');
