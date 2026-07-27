import type { Stock } from '@inventory/domain/stock/stock';

export interface StockRepository {
  /** Loads stock rows for the given items within a tenant (missing items absent). */
  findByItemIds(tenantId: string, itemIds: string[]): Promise<Stock[]>;
  /** Upserts a stock row by its natural key (tenantId, itemId). */
  save(stock: Stock): Promise<Stock>;
}

export const STOCK_REPOSITORY = Symbol('StockRepository');
