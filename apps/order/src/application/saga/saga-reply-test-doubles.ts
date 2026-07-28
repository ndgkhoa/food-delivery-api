import {
  DuplicateEventError,
  type EventEnvelopeHeaders,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import { Order } from '@order/domain/order/order';
import type { OrderRepository } from '@order/domain/order/order.repository';
import { OrderItem } from '@order/domain/order/order-item';
import { OrderSaga } from '@order/domain/saga/order-saga';
import type { OrderSagaRepository } from '@order/domain/saga/order-saga.repository';
import {
  NON_TERMINAL_SAGA_STATES,
  type StrandedSagaCandidate,
} from '@order/domain/saga/stranded-saga-sweep';
import type { OutboxCommandEntry, OutboxWriter } from '@order/domain/shared/outbox.port';
import type { TransactionPort } from '@order/domain/shared/transaction.port';

export const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';

/** Builds an order advanced to the given status via its own state machine. */
export function buildOrder(orderId: string, status: string): Order {
  const item = OrderItem.create({ itemId: ITEM_ID, qty: 2, unitPriceCents: 500 });
  let order = Order.create({ id: orderId, tenantId: TENANT_ID, userId: USER_ID, items: [item] });
  if (status === 'RESERVED' || status === 'CONFIRMED' || status === 'CANCELLED') {
    order = order.reserve();
  }
  if (status === 'CONFIRMED') {
    order = order.confirm();
  }
  return order;
}

/** The saga-wide correlation id the reply test doubles carry by default. */
export const DEFAULT_CORRELATION_ID = '66666666-6666-4666-8666-666666666666';

export function envelope(
  eventType: string,
  orderId: string,
  eventId: string,
  correlationId: string = DEFAULT_CORRELATION_ID,
): EventEnvelopeHeaders {
  return {
    eventId,
    eventType,
    aggregateId: orderId,
    tenantId: TENANT_ID,
    correlationId,
    occurredAt: new Date().toISOString(),
  };
}

export class FakeSagaRepository implements OrderSagaRepository {
  readonly rows = new Map<string, OrderSaga>();

  seed(saga: OrderSaga): void {
    this.rows.set(saga.orderId, saga);
  }

  async insert(saga: OrderSaga): Promise<void> {
    this.rows.set(saga.orderId, saga);
  }

  async findByOrderId(tenantId: string, orderId: string): Promise<OrderSaga | undefined> {
    const row = this.rows.get(orderId);
    return row && row.tenantId === tenantId ? row : undefined;
  }

  async transition(saga: OrderSaga): Promise<OrderSaga> {
    this.rows.set(saga.orderId, saga);
    return saga;
  }

  async findNonTerminal(): Promise<StrandedSagaCandidate[]> {
    return [...this.rows.values()]
      .filter((saga) => NON_TERMINAL_SAGA_STATES.includes(saga.state))
      .map((saga) => ({
        orderId: saga.orderId,
        tenantId: saga.tenantId,
        state: saga.state,
        updatedAt: saga.updatedAt,
      }));
  }
}

export class FakeOrderRepository implements OrderRepository {
  readonly rows = new Map<string, Order>();

  seed(order: Order): void {
    this.rows.set(order.id, order);
  }

  async insert(order: Order): Promise<Order> {
    this.rows.set(order.id, order);
    return order;
  }

  async updateStatus(order: Order): Promise<Order> {
    this.rows.set(order.id, order);
    return order;
  }

  async findById(tenantId: string, id: string): Promise<Order | undefined> {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : undefined;
  }
}

export class FakeOutboxWriter implements OutboxWriter {
  readonly entries: OutboxCommandEntry[] = [];

  async append(entry: OutboxCommandEntry): Promise<void> {
    this.entries.push(entry);
  }
}

/** Records ids; a second markProcessed for the same id throws — the dedupe signal. */
export class FakeProcessedEventStore implements ProcessedEventStorePort {
  private readonly seen = new Set<string>();

  async markProcessed(_tx: unknown, eventId: string): Promise<void> {
    if (this.seen.has(eventId)) {
      throw new DuplicateEventError(eventId);
    }
    this.seen.add(eventId);
  }
}

export class FakeTransaction implements TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}
