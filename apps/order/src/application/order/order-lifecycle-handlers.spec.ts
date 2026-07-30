import { CancelOrderHandler } from '@order/application/order/commands/cancel-order.handler';
import { ConfirmOrderHandler } from '@order/application/order/commands/confirm-order.handler';
import { GetOrderHandler } from '@order/application/order/queries/get-order.handler';
import { Order } from '@order/domain/order/order';
import type { OrderRepository } from '@order/domain/order/order.repository';
import { OrderItem } from '@order/domain/order/order-item';
import {
  OrderConcurrencyConflictError,
  OrderForbiddenError,
  OrderNotFoundError,
} from '@order/domain/shared/errors';
import type {
  InventoryGatewayPort,
  ReleaseOutcome,
  ReserveOutcome,
} from '@order/domain/shared/inventory-gateway.port';

const tenantId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const otherUserId = '99999999-9999-4999-8999-999999999999';
const itemId = '33333333-3333-4333-8333-333333333333';

/** Matches the config service's documented defaults so this suite's totals stay predictable. */
const defaultPricing = { deliveryFeeCents: 1500, vatRateBps: 1000, discountCents: 0 };

function buildReservedOrder(): Order {
  const item = OrderItem.create({ itemId, qty: 1, unitPriceCents: 500 });
  return Order.create({
    id: 'order-1',
    tenantId,
    userId: ownerId,
    items: [item],
    pricing: defaultPricing,
  }).reserve();
}

class FakeOrderRepository implements OrderRepository {
  readonly rows = new Map<string, Order>();
  failNextUpdate = false;

  seed(order: Order): void {
    this.rows.set(order.id, order);
  }

  async findById(t: string, id: string): Promise<Order | undefined> {
    const row = this.rows.get(id);
    return row && row.tenantId === t ? row : undefined;
  }

  async insert(order: Order): Promise<Order> {
    this.rows.set(order.id, order);
    return order;
  }

  async updateStatus(order: Order): Promise<Order> {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new OrderConcurrencyConflictError(order.id);
    }
    this.rows.set(order.id, order);
    return order;
  }
}

class FakeInventoryGateway implements InventoryGatewayPort {
  releaseCalls: string[] = [];
  releaseShouldFail = false;

  async reserve(): Promise<ReserveOutcome> {
    throw new Error('not used in these tests');
  }

  async release(_tenantId: string, orderId: string): Promise<ReleaseOutcome> {
    this.releaseCalls.push(orderId);
    if (this.releaseShouldFail) {
      throw new Error('inventory unreachable');
    }
    return { ok: true };
  }
}

describe('CancelOrderHandler', () => {
  it('cancels an order the caller owns and releases inventory', async () => {
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildReservedOrder());
    const inventoryGateway = new FakeInventoryGateway();
    const handler = new CancelOrderHandler(orderRepo, inventoryGateway);

    const cancelled = await handler.execute({
      tenantId,
      userId: ownerId,
      roles: [],
      orderId: 'order-1',
    });

    expect(cancelled.status).toBe('CANCELLED');
    expect(inventoryGateway.releaseCalls).toEqual(['order-1']);
  });

  it('allows an admin to cancel someone else’s order', async () => {
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildReservedOrder());
    const handler = new CancelOrderHandler(orderRepo, new FakeInventoryGateway());

    const cancelled = await handler.execute({
      tenantId,
      userId: otherUserId,
      roles: ['admin'],
      orderId: 'order-1',
    });

    expect(cancelled.status).toBe('CANCELLED');
  });

  it('rejects a non-owner, non-admin caller with OrderForbiddenError', async () => {
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildReservedOrder());
    const handler = new CancelOrderHandler(orderRepo, new FakeInventoryGateway());

    await expect(
      handler.execute({ tenantId, userId: otherUserId, roles: [], orderId: 'order-1' }),
    ).rejects.toThrow(OrderForbiddenError);
  });

  it('throws OrderNotFoundError for an unknown order', async () => {
    const handler = new CancelOrderHandler(new FakeOrderRepository(), new FakeInventoryGateway());
    await expect(
      handler.execute({ tenantId, userId: ownerId, roles: [], orderId: 'missing' }),
    ).rejects.toThrow(OrderNotFoundError);
  });

  it('propagates the optimistic-lock conflict from the repository', async () => {
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildReservedOrder());
    orderRepo.failNextUpdate = true;
    const handler = new CancelOrderHandler(orderRepo, new FakeInventoryGateway());

    await expect(
      handler.execute({ tenantId, userId: ownerId, roles: [], orderId: 'order-1' }),
    ).rejects.toThrow(OrderConcurrencyConflictError);
  });

  it('still returns the cancelled order when the inventory release fails', async () => {
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildReservedOrder());
    const inventoryGateway = new FakeInventoryGateway();
    inventoryGateway.releaseShouldFail = true;
    const handler = new CancelOrderHandler(orderRepo, inventoryGateway);

    const cancelled = await handler.execute({
      tenantId,
      userId: ownerId,
      roles: [],
      orderId: 'order-1',
    });
    expect(cancelled.status).toBe('CANCELLED');
  });
});

describe('ConfirmOrderHandler', () => {
  it('confirms a reserved order the caller owns', async () => {
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildReservedOrder());
    const handler = new ConfirmOrderHandler(orderRepo);

    const confirmed = await handler.execute({
      tenantId,
      userId: ownerId,
      roles: [],
      orderId: 'order-1',
    });
    expect(confirmed.status).toBe('CONFIRMED');
  });

  it('rejects a non-owner caller with OrderForbiddenError', async () => {
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildReservedOrder());
    const handler = new ConfirmOrderHandler(orderRepo);

    await expect(
      handler.execute({ tenantId, userId: otherUserId, roles: [], orderId: 'order-1' }),
    ).rejects.toThrow(OrderForbiddenError);
  });
});

describe('GetOrderHandler', () => {
  it('returns the order to its owner', async () => {
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildReservedOrder());
    const handler = new GetOrderHandler(orderRepo);

    const order = await handler.execute({
      tenantId,
      userId: ownerId,
      roles: [],
      orderId: 'order-1',
    });
    expect(order.id).toBe('order-1');
  });

  it('rejects a non-owner, non-admin caller with OrderForbiddenError', async () => {
    const orderRepo = new FakeOrderRepository();
    orderRepo.seed(buildReservedOrder());
    const handler = new GetOrderHandler(orderRepo);

    await expect(
      handler.execute({ tenantId, userId: otherUserId, roles: [], orderId: 'order-1' }),
    ).rejects.toThrow(OrderForbiddenError);
  });
});
