import type { Stock } from '@inventory/domain/stock/stock';

export interface StockRepository {
  /** Loads stock rows for the given items within a tenant (missing items absent). */
  findByItemIds(tenantId: string, itemIds: string[]): Promise<Stock[]>;
  /**
   * Atomically decrement available by `qty` in a single conditional UPDATE
   * (`... WHERE available >= qty`). Returns true if the row was decremented,
   * false if there was not enough stock (or no such row).
   *
   * This is the authoritative no-oversell guard: one atomic statement cannot lose
   * an update or drive available negative under concurrency, so correctness holds
   * even if the Redis lock expires or is lost. The lock only reduces contention.
   */
  decrementIfAvailable(tenantId: string, itemId: string, qty: number): Promise<boolean>;
  /** Atomically return `qty` units to available (on release). No-op if the row is absent. */
  increaseAvailable(tenantId: string, itemId: string, qty: number): Promise<void>;
}

export const STOCK_REPOSITORY = Symbol('StockRepository');
