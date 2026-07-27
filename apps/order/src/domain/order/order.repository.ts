import type { Order } from '@order/domain/order/order';

export interface OrderRepository {
  /**
   * Persists an order. A brand-new aggregate (`version === 0`) is inserted
   * together with its items in one transaction; an already-persisted
   * aggregate is updated via an atomic conditional `UPDATE ... WHERE version
   * = :version` that also bumps the version — the optimistic-lock guard.
   * Throws `OrderConcurrencyConflictError` when that conditional update
   * affects zero rows (a concurrent writer already moved the version on).
   */
  save(order: Order): Promise<Order>;
  /** Tenant-scoped lookup by id. `undefined` when no such order exists in the tenant. */
  findById(tenantId: string, id: string): Promise<Order | undefined>;
}

export const ORDER_REPOSITORY = Symbol('OrderRepository');
