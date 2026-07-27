import { DISTRIBUTED_LOCK, type DistributedLock } from '@food-delivery-api/shared-locking';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '@inventory/domain/reservation/reservation.repository';
import { TRANSACTION_PORT, type TransactionPort } from '@inventory/domain/shared/transaction.port';
import { STOCK_REPOSITORY, type StockRepository } from '@inventory/domain/stock/stock.repository';
import { Inject, Injectable } from '@nestjs/common';

export interface ReleaseStockCommand {
  tenantId: string;
  orderId: string;
}

export interface ReleaseStockResult {
  ok: boolean;
}

const RELEASE_LOCK_TTL_MS = 5000;

function lockKey(tenantId: string, itemId: string): string {
  return `inventory:lock:${tenantId}:${itemId}`;
}

/**
 * Releases every active reservation for an order, returning the held units to
 * stock — under the same per-item locks + DB transaction as reserve, so a
 * concurrent reserve/release on the same item can't interleave. Idempotent: an
 * order with no active reservations (never reserved, or already released) is a
 * clean no-op.
 */
@Injectable()
export class ReleaseStockHandler {
  constructor(
    @Inject(STOCK_REPOSITORY) private readonly stockRepository: StockRepository,
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    @Inject(DISTRIBUTED_LOCK) private readonly lock: DistributedLock,
  ) {}

  async execute(command: ReleaseStockCommand): Promise<ReleaseStockResult> {
    const { tenantId, orderId } = command;

    // Item set of an order is immutable, so reading it before locking is safe;
    // the tx re-reads under the lock to act on the authoritative current state.
    const active = await this.reservationRepository.findActiveByOrder(tenantId, orderId);
    if (active.length === 0) {
      return { ok: true };
    }

    const keys = active.map((reservation) => lockKey(tenantId, reservation.itemId));
    await this.lock.withLocks(keys, RELEASE_LOCK_TTL_MS, () =>
      this.transaction.runInTransaction(() => this.releaseWithinTransaction(tenantId, orderId)),
    );
    return { ok: true };
  }

  private async releaseWithinTransaction(tenantId: string, orderId: string): Promise<void> {
    const current = await this.reservationRepository.findActiveByOrder(tenantId, orderId);
    if (current.length === 0) {
      return;
    }

    // One atomic increment per hold — no read-modify-write, so concurrent
    // reserve/release on the same item can't lose an update.
    for (const reservation of current) {
      await this.stockRepository.increaseAvailable(tenantId, reservation.itemId, reservation.qty);
      await this.reservationRepository.save(reservation.release());
    }
  }
}
