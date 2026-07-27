import { randomUUID } from 'node:crypto';
import { DISTRIBUTED_LOCK, type DistributedLock } from '@food-delivery-api/shared-locking';
import { Reservation } from '@inventory/domain/reservation/reservation';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '@inventory/domain/reservation/reservation.repository';
import { InsufficientStockError, StockNotFoundError } from '@inventory/domain/shared/errors';
import { TRANSACTION_PORT, type TransactionPort } from '@inventory/domain/shared/transaction.port';
import { STOCK_REPOSITORY, type StockRepository } from '@inventory/domain/stock/stock.repository';
import { Inject, Injectable } from '@nestjs/common';

export interface ReserveItem {
  itemId: string;
  qty: number;
}

export interface ReserveStockCommand {
  tenantId: string;
  orderId: string;
  items: ReserveItem[];
}

export interface ReserveStockResult {
  ok: boolean;
  reservationIds: string[];
}

/**
 * Lock TTL bounding the reserve critical section. Long enough for the DB tx,
 * short enough that a crashed holder self-heals quickly (the fencing token +
 * DB re-check keep correctness even if the lock expires early).
 */
const RESERVE_LOCK_TTL_MS = 5000;

function lockKey(tenantId: string, itemId: string): string {
  return `inventory:lock:${tenantId}:${itemId}`;
}

/**
 * Reserve stock atomically with no oversell. Critical section:
 *   1. Acquire a per-item distributed lock for every ordered item, in sorted
 *      order (deadlock-free for multi-item carts).
 *   2. Inside a DB transaction: re-read stock, decrement (domain re-checks
 *      available ≥ qty), insert a reservation per item — all or nothing.
 *   3. Commit, then the lock is released.
 * Idempotent: a re-reserve of an order that already holds active reservations
 * returns the existing ids instead of double-decrementing.
 */
@Injectable()
export class ReserveStockHandler {
  constructor(
    @Inject(STOCK_REPOSITORY) private readonly stockRepository: StockRepository,
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    @Inject(DISTRIBUTED_LOCK) private readonly lock: DistributedLock,
  ) {}

  async execute(command: ReserveStockCommand): Promise<ReserveStockResult> {
    const { tenantId, orderId, items } = command;
    const keys = items.map((item) => lockKey(tenantId, item.itemId));

    return this.lock.withLocks(keys, RESERVE_LOCK_TTL_MS, async () => {
      try {
        const reservationIds = await this.transaction.runInTransaction(() =>
          this.reserveWithinTransaction(tenantId, orderId, items),
        );
        return { ok: true, reservationIds };
      } catch (error) {
        // No stock / not enough stock is an expected business outcome, not a
        // fault: the tx rolled back, so report a clean failed reserve.
        if (error instanceof InsufficientStockError || error instanceof StockNotFoundError) {
          return { ok: false, reservationIds: [] };
        }
        throw error;
      }
    });
  }

  private async reserveWithinTransaction(
    tenantId: string,
    orderId: string,
    items: ReserveItem[],
  ): Promise<string[]> {
    const existing = await this.reservationRepository.findActiveByOrder(tenantId, orderId);
    if (existing.length > 0) {
      return existing.map((reservation) => reservation.id);
    }

    const stocks = await this.stockRepository.findByItemIds(
      tenantId,
      items.map((item) => item.itemId),
    );
    const stockByItem = new Map(stocks.map((stock) => [stock.itemId, stock]));

    const reservationIds: string[] = [];
    for (const item of items) {
      const stock = stockByItem.get(item.itemId);
      if (!stock) {
        throw new StockNotFoundError(item.itemId);
      }
      await this.stockRepository.save(stock.reserve(item.qty));
      const reservation = Reservation.create({
        id: randomUUID(),
        tenantId,
        orderId,
        itemId: item.itemId,
        qty: item.qty,
      });
      const saved = await this.reservationRepository.save(reservation);
      reservationIds.push(saved.id);
    }
    return reservationIds;
  }
}
