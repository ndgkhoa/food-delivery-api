import type { DistributedLock } from '@food-delivery-api/shared-locking';
import { ReleaseStockHandler } from '@inventory/application/reservation/commands/release-stock.handler';
import { ReserveStockHandler } from '@inventory/application/reservation/commands/reserve-stock.handler';
import { Reservation } from '@inventory/domain/reservation/reservation';
import type { ReservationRepository } from '@inventory/domain/reservation/reservation.repository';
import type { TransactionPort } from '@inventory/domain/shared/transaction.port';
import { Stock } from '@inventory/domain/stock/stock';
import type { StockRepository } from '@inventory/domain/stock/stock.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const orderId = '33333333-3333-4333-8333-333333333333';
const itemA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function stockKey(t: string, i: string): string {
  return `${t}:${i}`;
}

class FakeStockRepository implements StockRepository {
  private readonly available = new Map<string, number>();

  seed(stock: Stock): void {
    this.available.set(stockKey(stock.tenantId, stock.itemId), stock.available);
  }

  availableOf(t: string, i: string): number | undefined {
    return this.available.get(stockKey(t, i));
  }

  async findByItemIds(t: string, itemIds: string[]): Promise<Stock[]> {
    return itemIds
      .map((itemId) => {
        const units = this.available.get(stockKey(t, itemId));
        return units === undefined
          ? undefined
          : Stock.reconstitute({ tenantId: t, itemId, available: units });
      })
      .filter((stock): stock is Stock => stock !== undefined);
  }

  async decrementIfAvailable(t: string, itemId: string, qty: number): Promise<boolean> {
    const key = stockKey(t, itemId);
    const units = this.available.get(key);
    if (units === undefined || units < qty) {
      return false;
    }
    this.available.set(key, units - qty);
    return true;
  }

  async increaseAvailable(t: string, itemId: string, qty: number): Promise<void> {
    const key = stockKey(t, itemId);
    const units = this.available.get(key);
    if (units !== undefined) {
      this.available.set(key, units + qty);
    }
  }
}

class FakeReservationRepository implements ReservationRepository {
  private readonly rows = new Map<string, Reservation>();

  async save(reservation: Reservation): Promise<Reservation> {
    this.rows.set(reservation.id, reservation);
    return reservation;
  }

  async findActiveByOrder(t: string, order: string): Promise<Reservation[]> {
    return [...this.rows.values()].filter(
      (r) => r.tenantId === t && r.orderId === order && r.status === 'ACTIVE',
    );
  }

  async releaseIfActive(reservation: Reservation): Promise<boolean> {
    const stored = this.rows.get(reservation.id);
    if (stored?.status !== 'ACTIVE') {
      return false;
    }
    this.rows.set(
      stored.id,
      Reservation.reconstitute({
        id: stored.id,
        tenantId: stored.tenantId,
        orderId: stored.orderId,
        itemId: stored.itemId,
        qty: stored.qty,
        status: 'RELEASED',
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
      }),
    );
    return true;
  }

  all(): Reservation[] {
    return [...this.rows.values()];
  }
}

class FakeTransaction implements TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

class FakeDistributedLock implements DistributedLock {
  async acquire(): Promise<string | null> {
    return 'token';
  }
  async release(): Promise<boolean> {
    return true;
  }
  async withLocks<T>(_keys: string[], _ttlMs: number, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

function buildHandlers() {
  const stockRepo = new FakeStockRepository();
  const reservationRepo = new FakeReservationRepository();
  const reserve = new ReserveStockHandler(
    stockRepo,
    reservationRepo,
    new FakeTransaction(),
    new FakeDistributedLock(),
  );
  const release = new ReleaseStockHandler(
    stockRepo,
    reservationRepo,
    new FakeTransaction(),
    new FakeDistributedLock(),
  );
  return { stockRepo, reservationRepo, reserve, release };
}

describe('ReserveStockHandler', () => {
  it('reserves available stock and decrements it', async () => {
    const { stockRepo, reserve } = buildHandlers();
    stockRepo.seed(Stock.create({ tenantId, itemId: itemA, available: 10 }));

    const result = await reserve.execute({ tenantId, orderId, items: [{ itemId: itemA, qty: 3 }] });

    expect(result.ok).toBe(true);
    expect(result.reservationIds).toHaveLength(1);
    expect(stockRepo.availableOf(tenantId, itemA)).toBe(7);
  });

  it('reserves multiple items atomically', async () => {
    const { stockRepo, reserve } = buildHandlers();
    stockRepo.seed(Stock.create({ tenantId, itemId: itemA, available: 5 }));
    stockRepo.seed(Stock.create({ tenantId, itemId: itemB, available: 5 }));

    const result = await reserve.execute({
      tenantId,
      orderId,
      items: [
        { itemId: itemA, qty: 2 },
        { itemId: itemB, qty: 4 },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.reservationIds).toHaveLength(2);
    expect(stockRepo.availableOf(tenantId, itemA)).toBe(3);
    expect(stockRepo.availableOf(tenantId, itemB)).toBe(1);
  });

  it('fails (ok:false) without decrementing when stock is insufficient', async () => {
    const { stockRepo, reservationRepo, reserve } = buildHandlers();
    stockRepo.seed(Stock.create({ tenantId, itemId: itemA, available: 2 }));

    const result = await reserve.execute({ tenantId, orderId, items: [{ itemId: itemA, qty: 5 }] });

    expect(result.ok).toBe(false);
    expect(result.reservationIds).toEqual([]);
    expect(stockRepo.availableOf(tenantId, itemA)).toBe(2);
    expect(reservationRepo.all()).toHaveLength(0);
  });

  it('fails (ok:false) when the item has no stock record', async () => {
    const { reserve } = buildHandlers();

    const result = await reserve.execute({ tenantId, orderId, items: [{ itemId: itemA, qty: 1 }] });

    expect(result.ok).toBe(false);
  });

  it('is idempotent — re-reserving an order returns the same ids and decrements once', async () => {
    const { stockRepo, reserve } = buildHandlers();
    stockRepo.seed(Stock.create({ tenantId, itemId: itemA, available: 10 }));

    const first = await reserve.execute({ tenantId, orderId, items: [{ itemId: itemA, qty: 3 }] });
    const second = await reserve.execute({ tenantId, orderId, items: [{ itemId: itemA, qty: 3 }] });

    expect(second.reservationIds).toEqual(first.reservationIds);
    expect(stockRepo.availableOf(tenantId, itemA)).toBe(7);
  });
});

describe('ReleaseStockHandler', () => {
  it('returns reserved stock and marks reservations released', async () => {
    const { stockRepo, reservationRepo, reserve, release } = buildHandlers();
    stockRepo.seed(Stock.create({ tenantId, itemId: itemA, available: 10 }));
    await reserve.execute({ tenantId, orderId, items: [{ itemId: itemA, qty: 4 }] });

    const result = await release.execute({ tenantId, orderId });

    expect(result.ok).toBe(true);
    expect(stockRepo.availableOf(tenantId, itemA)).toBe(10);
    expect(reservationRepo.all().every((r) => r.status === 'RELEASED')).toBe(true);
  });

  it('is a clean no-op when the order has no active reservations', async () => {
    const { release } = buildHandlers();

    await expect(release.execute({ tenantId, orderId })).resolves.toEqual({ ok: true });
  });
});
