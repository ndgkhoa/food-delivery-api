import { randomUUID } from 'node:crypto';
import { DISTRIBUTED_LOCK, type DistributedLock } from '@food-delivery-api/shared-locking';
import { Reservation } from '@inventory/domain/reservation/reservation';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '@inventory/domain/reservation/reservation.repository';
import {
  IdempotencyConflictError,
  InsufficientStockError,
  InvalidReserveRequestError,
  StockNotFoundError,
} from '@inventory/domain/shared/errors';
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

const RESERVE_LOCK_TTL_MS = 5000;

const PG_UNIQUE_VIOLATION = '23505';

function lockKey(tenantId: string, itemId: string): string {
  return `inventory:lock:${tenantId}:${itemId}`;
}

function normalizeItems(items: ReserveItem[]): ReserveItem[] {
  if (items.length === 0) {
    throw new InvalidReserveRequestError('no items to reserve');
  }
  const byItem = new Map<string, number>();
  for (const item of items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0) {
      throw new InvalidReserveRequestError(
        `quantity for item "${item.itemId}" must be a positive integer`,
      );
    }
    byItem.set(item.itemId, (byItem.get(item.itemId) ?? 0) + item.qty);
  }
  return [...byItem.entries()]
    .map(([itemId, qty]) => ({ itemId, qty }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
}

function isUniqueViolation(error: unknown): boolean {
  const wrapped = error as { code?: string; driverError?: { code?: string } };
  return (wrapped?.driverError?.code ?? wrapped?.code) === PG_UNIQUE_VIOLATION;
}

function assertReplayMatches(
  existing: Reservation[],
  requested: ReserveItem[],
  orderId: string,
): void {
  const existingByItem = new Map(existing.map((r) => [r.itemId, r.qty]));
  const same =
    existing.length === requested.length &&
    requested.every((item) => existingByItem.get(item.itemId) === item.qty);
  if (!same) {
    throw new IdempotencyConflictError(orderId);
  }
}

@Injectable()
export class ReserveStockHandler {
  constructor(
    @Inject(STOCK_REPOSITORY) private readonly stockRepository: StockRepository,
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    @Inject(DISTRIBUTED_LOCK) private readonly lock: DistributedLock,
  ) {}

  async execute(command: ReserveStockCommand): Promise<ReserveStockResult> {
    const { tenantId, orderId } = command;
    const items = normalizeItems(command.items);
    const keys = items.map((item) => lockKey(tenantId, item.itemId));

    return this.lock.withLocks(keys, RESERVE_LOCK_TTL_MS, async () => {
      try {
        const reservationIds = await this.transaction.runInTransaction(() =>
          this.reserveWithinTransaction(tenantId, orderId, items),
        );
        return { ok: true, reservationIds };
      } catch (error) {
        if (error instanceof InsufficientStockError || error instanceof StockNotFoundError) {
          return { ok: false, reservationIds: [] };
        }
        if (isUniqueViolation(error)) {
          throw new IdempotencyConflictError(orderId);
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
      assertReplayMatches(existing, items, orderId);
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
      const reserved = await this.stockRepository.decrementIfAvailable(
        tenantId,
        item.itemId,
        item.qty,
      );
      if (!reserved) {
        throw new InsufficientStockError(item.itemId, item.qty, stock.available);
      }
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
