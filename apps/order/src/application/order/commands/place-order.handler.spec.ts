import { randomUUID } from 'node:crypto';
import {
  type OrderPricingSettingsClient,
  type PlaceOrderCommand,
  PlaceOrderHandler,
} from '@order/application/order/commands/place-order.handler';
import type { IdempotencyRepository } from '@order/domain/idempotency/idempotency.repository';
import { Order } from '@order/domain/order/order';
import type { OrderRepository } from '@order/domain/order/order.repository';
import type { OrderSaga } from '@order/domain/saga/order-saga';
import type { OrderSagaRepository } from '@order/domain/saga/order-saga.repository';
import type {
  CatalogGatewayPort,
  MenuItemSnapshot,
} from '@order/domain/shared/catalog-gateway.port';
import { InvalidOrderRequestError, MenuValidationError } from '@order/domain/shared/errors';
import type { OutboxCommandEntry, OutboxWriter } from '@order/domain/shared/outbox.port';
import type { TransactionPort } from '@order/domain/shared/transaction.port';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const otherItemId = '44444444-4444-4444-8444-444444444444';

class FakeOrderRepository implements OrderRepository {
  readonly rows = new Map<string, Order>();

  async insert(order: Order): Promise<Order> {
    this.rows.set(order.id, order);
    return order;
  }

  async updateStatus(order: Order): Promise<Order> {
    this.rows.set(order.id, order);
    return order;
  }

  async findById(t: string, id: string): Promise<Order | undefined> {
    const row = this.rows.get(id);
    return row && row.tenantId === t ? row : undefined;
  }

  async findRecentByTenant(t: string, userIdFilter: string, limit: number): Promise<Order[]> {
    return [...this.rows.values()]
      .filter((row) => row.tenantId === t && row.userId === userIdFilter)
      .slice(0, limit);
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

class FakeSagaRepository implements OrderSagaRepository {
  readonly rows = new Map<string, OrderSaga>();

  async insert(saga: OrderSaga): Promise<void> {
    this.rows.set(saga.orderId, saga);
  }

  async findByOrderId(t: string, orderId: string): Promise<OrderSaga | undefined> {
    const row = this.rows.get(orderId);
    return row && row.tenantId === t ? row : undefined;
  }

  async transition(saga: OrderSaga): Promise<OrderSaga> {
    this.rows.set(saga.orderId, saga);
    return saga;
  }

  async findNonTerminal(): Promise<never[]> {
    return [];
  }

  async recordReconcileAttempt(): Promise<void> {}

  async resetReconcileAttempts(): Promise<'reset' | 'terminal' | 'not_found'> {
    return 'not_found';
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

class FakeOutboxWriter implements OutboxWriter {
  readonly entries: OutboxCommandEntry[] = [];

  async append(entry: OutboxCommandEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class FakeTransaction implements TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

class FakeSettingsClient implements OrderPricingSettingsClient {
  private readonly values = new Map<string, number>();

  seed(key: string, value: number): void {
    this.values.set(key, value);
  }

  async getInt(key: string, _tenantId: string, defaultValue: number): Promise<number> {
    return this.values.get(key) ?? defaultValue;
  }
}

function buildHandler() {
  const orderRepo = new FakeOrderRepository();
  const idempotencyRepo = new FakeIdempotencyRepository();
  const sagaRepo = new FakeSagaRepository();
  const catalogGateway = new FakeCatalogGateway();
  const outbox = new FakeOutboxWriter();
  const configClient = new FakeSettingsClient();
  const handler = new PlaceOrderHandler(
    orderRepo,
    idempotencyRepo,
    sagaRepo,
    catalogGateway,
    outbox,
    new FakeTransaction(),
    configClient,
  );
  return { orderRepo, idempotencyRepo, sagaRepo, catalogGateway, outbox, configClient, handler };
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

describe('PlaceOrderHandler (async saga)', () => {
  it('persists a PENDING order, opens the saga STARTED, and enqueues ReserveStock', async () => {
    const { catalogGateway, sagaRepo, outbox, handler } = buildHandler();
    catalogGateway.seed({ itemId, restaurantId: 'r-1', priceCents: 500, isAvailable: true });

    const order = await handler.execute(baseCommand());

    expect(order.status).toBe('PENDING');
    expect(order.restaurantId).toBe('r-1');
    expect(order.subtotalCents).toBe(1000);
    expect(order.deliveryFeeCents).toBe(1500);
    expect(order.vatCents).toBe(100);
    expect(order.discountCents).toBe(0);
    expect(order.totalCents).toBe(2600);

    const saga = sagaRepo.rows.get(order.id);
    expect(saga?.state).toBe('STARTED');

    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]).toMatchObject({
      topic: 'inventory.commands',
      eventType: 'ReserveStock',
      aggregateId: order.id,
      payload: { orderId: order.id, items: [{ itemId, qty: 2 }] },
    });
    expect(outbox.entries[0].correlationId).toBeDefined();
    expect(outbox.entries[0].correlationId).toBe(saga?.correlationId);
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

  it("reads the tenant's delivery-fee/VAT/discount config and applies it to the order total", async () => {
    const { catalogGateway, configClient, handler } = buildHandler();
    catalogGateway.seed({ itemId, restaurantId: 'r-1', priceCents: 500, isAvailable: true });
    configClient.seed('order.delivery_fee_cents', 2000);
    configClient.seed('order.vat_rate_bps', 500);
    configClient.seed('order.discount_cents', 100);

    const order = await handler.execute(baseCommand());

    expect(order.subtotalCents).toBe(1000);
    expect(order.deliveryFeeCents).toBe(2000);
    expect(order.vatCents).toBe(50);
    expect(order.discountCents).toBe(100);
    expect(order.totalCents).toBe(1000 + 2000 + 50 - 100);
  });

  it('rejects a cart mixing items from two different restaurants', async () => {
    const { catalogGateway, handler } = buildHandler();
    catalogGateway.seed({ itemId, restaurantId: 'r-1', priceCents: 500, isAvailable: true });
    catalogGateway.seed({
      itemId: otherItemId,
      restaurantId: 'r-2',
      priceCents: 700,
      isAvailable: true,
    });

    await expect(
      handler.execute(
        baseCommand({
          items: [
            { itemId, qty: 1 },
            { itemId: otherItemId, qty: 1 },
          ],
        }),
      ),
    ).rejects.toThrow(InvalidOrderRequestError);
  });

  it('passes the single shared restaurantId through when every item belongs to it', async () => {
    const { catalogGateway, handler } = buildHandler();
    catalogGateway.seed({ itemId, restaurantId: 'r-1', priceCents: 500, isAvailable: true });
    catalogGateway.seed({
      itemId: otherItemId,
      restaurantId: 'r-1',
      priceCents: 700,
      isAvailable: true,
    });

    const order = await handler.execute(
      baseCommand({
        items: [
          { itemId, qty: 1 },
          { itemId: otherItemId, qty: 1 },
        ],
      }),
    );

    expect(order.restaurantId).toBe('r-1');
  });

  it('replays the same order on a duplicate key without re-validating or re-enqueuing', async () => {
    const { catalogGateway, outbox, sagaRepo, handler } = buildHandler();
    catalogGateway.seed({ itemId, restaurantId: 'r-1', priceCents: 500, isAvailable: true });
    const command = baseCommand();

    const first = await handler.execute(command);
    const second = await handler.execute(command);

    expect(second.id).toBe(first.id);
    expect(second.status).toBe('PENDING');
    expect(catalogGateway.calls).toBe(1);
    expect(outbox.entries).toHaveLength(1);
    expect(sagaRepo.rows.size).toBe(1);
  });
});
