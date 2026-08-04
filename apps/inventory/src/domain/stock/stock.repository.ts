import type { Stock } from '@inventory/domain/stock/stock';

export interface StockRepository {
  findByItemIds(tenantId: string, itemIds: string[]): Promise<Stock[]>;
  decrementIfAvailable(tenantId: string, itemId: string, qty: number): Promise<boolean>;
  increaseAvailable(tenantId: string, itemId: string, qty: number): Promise<void>;
}

export const STOCK_REPOSITORY = Symbol('StockRepository');
