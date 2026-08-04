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

    for (const reservation of current) {
      const released = await this.reservationRepository.releaseIfActive(reservation);
      if (released) {
        await this.stockRepository.increaseAvailable(tenantId, reservation.itemId, reservation.qty);
      }
    }
  }
}
