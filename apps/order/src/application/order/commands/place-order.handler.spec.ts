import { randomUUID } from 'node:crypto';
import type { IdempotencyRepository } from '@order/domain/idempotency/idempotency.repository';
import type { Order } from '@order/domain/order/order';
import type { OrderRepository } from '@order/domain/order/order.repository';
import type {
  CatalogGatewayPort,
  MenuItemSnapshot,
} from '@order/domain/shared/catalog-gateway.port';
import { InsufficientStockError, MenuValidationError } from '@order/domain/shared/errors';
import type {
  InventoryGatewayPort,
  ReleaseOutcome,
  ReserveItemCommand,
  ReserveOutcome,
} from '@order/domain/shared/inventory-gateway.port';
import type { TransactionPort } from '@order/domain/shared/transaction.port';
import { type PlaceOrderCommand, PlaceOrderHandler } from './place-order.handler';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';

class FakeOrderRepository implements OrderRepository {
  readonly rows = new Map<string, Order>();
  failNextInsert = false;

  async save(order: Order): Promise<Order> {
    if (order.version === 0 && this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error('simulated persist failure');
    }
    this.rows.set(order.id, order);
    return order;
  }

  async findById(t: string, id: string): Promise<Order | undefined> {
    const row = this.rows.get(id);
    return row && row.tenantId === t ? row : undefined;
  }
}

class FakeIdempotencyRepository implements IdempotencyRepository {
  private readonly rows = new Map<string, string>();

  private compositeKey(t: string, u: string, k: string): string {
    return `${t}:${u}:${k}`;
  }

  async findOrderId(t: string, u: string, k: string): Promise<string | undefined> {
    return this.rows.get(this.compositeKey(t, u, k));
  }

  async save(t: string, u: string, k: string, orderId: string): Promise<void> {
    const key = this.compositeKey(t, u, k);
    if (this.rows.has(key)) {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    }
    this.rows.set(key, orderId);
  }
}

class FakeCatalogGateway implements CatalogGatewayPort {
  private readonly items = new Map<string, MenuItemSnapshot>();
  calls = 0;

  seed(snapshot: MenuItemSnapshot): void {
    this.items.set(snapshot.itemId, snapshot);
  }

  async validateItems(_tenantId: string, itemIds: string[]): Promise<MenuItemSnapshot[]> {
    this.calls += 1;
    return itemIds
      .map((id) => this.items.get(id))
      .filter((snapshot): snapshot is MenuItemSnapshot => snapshot !== undefined);
  }
}

class FakeInventoryGateway implements InventoryGatewayPort {
  reserveOutcome: ReserveOutcome = { ok: true, reservationIds: ['reservation-1'] };
  reserveCalls: { orderId: string; items: ReserveItemCommand[] }[] = [];
  releaseCalls: string[] = [];

  async reserve(
    _tenantId: string,
    orderId: string,
    items: ReserveItemCommand[],
  ): Promise<ReserveOutcome> {
    this.reserveCalls.push({ orderId, items });
    return this.reserveOutcome;
  }

  async release(_tenantId: string, orderId: string): Promise<ReleaseOutcome> {
    this.releaseCalls.push(orderId);
    return { ok: true };
  }
}

class FakeTransaction implements TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

function buildHandler() {
  const orderRepo = new FakeOrderRepository();
  const idempotencyRepo = new FakeIdempotencyRepository();
  const catalogGateway = new FakeCatalogGateway();
  const inventoryGateway = new FakeInventoryGateway();
  const handler = new PlaceOrderHandler(
    orderRepo,
    idempotencyRepo,
    catalogGateway,
    inventoryGateway,
    new FakeTransaction(),
  );
  return { orderRepo, idempotencyRepo, catalogGateway, inventoryGateway, handler };
}

function baseCommand(overrides?: Partial<PlaceOrderCommand>): PlaceOrderCommand {
  return {
    tenantId,
    userId,
    idempotencyKey: randomUUID(),
    items: [{ itemId, qty: 2 }],
    ...overrides,
  };
}

describe('PlaceOrderHandler', () => {
  it('places an order, reserves stock, and computes total from the catalog price', async () => {
    const { catalogGateway, handler } = buildHandler();
    catalogGateway.seed({ itemId, restaurantId: 'r-1', priceCents: 500, isAvailable: true });

    const order = await handler.execute(baseCommand());

    expect(order.status).toBe('RESERVED');
    expect(order.totalCents).toBe(1000);
  });

  it('rejects when a requested item is not found in the catalog', async () => {
    const { handler } = buildHandler();
    await expect(handler.execute(baseCommand())).rejects.toThrow(MenuValidationError);
  });

  it('rejects when a requested item is unavailable', async () => {
    const { catalogGateway, handler } = buildHandler();
    catalogGateway.seed({ itemId, restaurantId: 'r-1', priceCents: 500, isAvailable: false });
    await expect(handler.execute(baseCommand())).rejects.toThrow(MenuValidationError);
  });

  it('cancels the order and throws InsufficientStockError when reserve fails', async () => {
    const { catalogGateway, inventoryGateway, orderRepo, handler } = buildHandler();
    catalogGateway.seed({ itemId, restaurantId: 'r-1', priceCents: 500, isAvailable: true });
    inventoryGateway.reserveOutcome = { ok: false, reservationIds: [] };

    await expect(handler.execute(baseCommand())).rejects.toThrow(InsufficientStockError);

    const persisted = [...orderRepo.rows.values()][0];
    expect(persisted.status).toBe('CANCELLED');
  });

  it('replays the same order on a duplicate idempotency key without re-calling catalog/inventory', async () => {
    const { catalogGateway, inventoryGateway, handler } = buildHandler();
    catalogGateway.seed({ itemId, restaurantId: 'r-1', priceCents: 500, isAvailable: true });
    const command = baseCommand();

    const first = await handler.execute(command);
    const second = await handler.execute(command);

    expect(second.id).toBe(first.id);
    expect(catalogGateway.calls).toBe(1);
    expect(inventoryGateway.reserveCalls).toHaveLength(1);
  });

  it('compensates with a release when the post-reserve persist fails', async () => {
    const { catalogGateway, inventoryGateway, orderRepo, handler } = buildHandler();
    catalogGateway.seed({ itemId, restaurantId: 'r-1', priceCents: 500, isAvailable: true });
    orderRepo.failNextInsert = true;

    await expect(handler.execute(baseCommand())).rejects.toThrow('simulated persist failure');

    expect(inventoryGateway.releaseCalls).toHaveLength(1);
    expect(inventoryGateway.releaseCalls[0]).toBe(inventoryGateway.reserveCalls[0].orderId);
  });
});
