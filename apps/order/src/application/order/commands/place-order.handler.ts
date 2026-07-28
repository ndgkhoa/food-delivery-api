import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { reserveStockCommand } from '@order/application/saga/saga-commands';
import {
  IDEMPOTENCY_REPOSITORY,
  type IdempotencyRepository,
} from '@order/domain/idempotency/idempotency.repository';
import { Order } from '@order/domain/order/order';
import { ORDER_REPOSITORY, type OrderRepository } from '@order/domain/order/order.repository';
import { OrderItem } from '@order/domain/order/order-item';
import { OrderSaga } from '@order/domain/saga/order-saga';
import {
  ORDER_SAGA_REPOSITORY,
  type OrderSagaRepository,
} from '@order/domain/saga/order-saga.repository';
import {
  CATALOG_GATEWAY_PORT,
  type CatalogGatewayPort,
} from '@order/domain/shared/catalog-gateway.port';
import {
  IdempotencyConflictError,
  InvalidOrderRequestError,
  MenuValidationError,
} from '@order/domain/shared/errors';
import { OUTBOX_WRITER, type OutboxWriter } from '@order/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@order/domain/shared/transaction.port';

interface PlaceOrderItemInput {
  itemId: string;
  qty: number;
}

export interface PlaceOrderCommand {
  tenantId: string;
  userId: string;
  idempotencyKey: string;
  items: PlaceOrderItemInput[];
}

/** Postgres SQLSTATE for unique_violation — a concurrent duplicate idempotency key. */
const PG_UNIQUE_VIOLATION = '23505';

/** True for a Postgres unique_violation, however TypeORM wraps the driver error. */
function isUniqueViolation(error: unknown): boolean {
  const wrapped = error as { code?: string; driverError?: { code?: string } };
  return (wrapped?.driverError?.code ?? wrapped?.code) === PG_UNIQUE_VIOLATION;
}

function assertValidCommand(command: PlaceOrderCommand): void {
  if (command.items.length === 0) {
    throw new InvalidOrderRequestError('order must contain at least one item');
  }
  for (const item of command.items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0) {
      throw new InvalidOrderRequestError(
        `quantity for item "${item.itemId}" must be a positive integer`,
      );
    }
  }
}

/**
 * Places an order as an ASYNCHRONOUS saga. Menu validation stays a synchronous
 * catalog query (never trusts client prices), but reserve/charge no longer run
 * inline: in ONE transaction we claim the idempotency key, insert the PENDING
 * order, open its saga (STARTED), and append the first `ReserveStock` command to
 * the outbox. A polling relay publishes that command to Kafka; inventory and
 * payment replies drive the saga forward on later ticks. The caller gets the
 * PENDING order back immediately and polls `GET /orders/:id` for the terminal
 * state. Because everything commits together, a lost response just replays to
 * the same durable order — the saga, not this call, owns progression.
 */
@Injectable()
export class PlaceOrderHandler {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(IDEMPOTENCY_REPOSITORY) private readonly idempotencyRepository: IdempotencyRepository,
    @Inject(ORDER_SAGA_REPOSITORY) private readonly sagaRepository: OrderSagaRepository,
    @Inject(CATALOG_GATEWAY_PORT) private readonly catalogGateway: CatalogGatewayPort,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<Order> {
    assertValidCommand(command);

    // 1. Replay: an existing key maps to a durable order whose saga is already
    //    in flight — return it as-is rather than starting a second saga.
    const existingOrderId = await this.idempotencyRepository.findOrderId(
      command.tenantId,
      command.userId,
      command.idempotencyKey,
    );
    if (existingOrderId) {
      return this.loadExisting(command.tenantId, existingOrderId, command.idempotencyKey);
    }

    // 2. Validate menu against the catalog — price/availability are never trusted from the client.
    const orderItems = await this.buildOrderItems(command);
    const orderId = randomUUID();
    const pendingOrder = Order.create({
      id: orderId,
      tenantId: command.tenantId,
      userId: command.userId,
      items: orderItems,
    });

    // 3. Durably record intent + start the saga atomically: claim the key, insert
    //    the PENDING order, open the STARTED saga, and enqueue the ReserveStock
    //    command — all in ONE transaction so the relay can never publish a
    //    command for an order that failed to persist.
    try {
      return await this.transaction.runInTransaction(async () => {
        await this.idempotencyRepository.save(
          command.tenantId,
          command.userId,
          command.idempotencyKey,
          orderId,
        );
        const persistedOrder = await this.orderRepository.insert(pendingOrder);
        await this.sagaRepository.insert(OrderSaga.start({ orderId, tenantId: command.tenantId }));
        await this.outbox.append(
          reserveStockCommand(
            orderId,
            persistedOrder.items.map((item) => ({ itemId: item.itemId, qty: item.qty })),
          ),
        );
        return persistedOrder;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A concurrent request won the key; its order committed atomically with
        // the claim, so return that one.
        return this.resolveConcurrentClaim(
          command.tenantId,
          command.userId,
          command.idempotencyKey,
        );
      }
      throw error;
    }
  }

  private async loadExisting(
    tenantId: string,
    orderId: string,
    idempotencyKey: string,
  ): Promise<Order> {
    const order = await this.orderRepository.findById(tenantId, orderId);
    if (!order) {
      // The claim + order insert are atomic, so a visible mapping should imply a
      // visible order. Treat the vanishing-small window as transiently retryable.
      throw new IdempotencyConflictError(
        `order for key "${idempotencyKey}" is being created — retry shortly`,
      );
    }
    return order;
  }

  private async resolveConcurrentClaim(
    tenantId: string,
    userId: string,
    idempotencyKey: string,
  ): Promise<Order> {
    const winningOrderId = await this.idempotencyRepository.findOrderId(
      tenantId,
      userId,
      idempotencyKey,
    );
    if (winningOrderId) {
      return this.loadExisting(tenantId, winningOrderId, idempotencyKey);
    }
    throw new IdempotencyConflictError(
      `order for key "${idempotencyKey}" is being created — retry shortly`,
    );
  }

  private async buildOrderItems(command: PlaceOrderCommand): Promise<OrderItem[]> {
    const distinctItemIds = [...new Set(command.items.map((item) => item.itemId))];
    const menuItems = await this.catalogGateway.validateItems(command.tenantId, distinctItemIds);
    const menuByItemId = new Map(menuItems.map((item) => [item.itemId, item]));

    return command.items.map((item) => {
      const menuItem = menuByItemId.get(item.itemId);
      if (!menuItem) {
        throw new MenuValidationError(`menu item "${item.itemId}" not found for this tenant`);
      }
      if (!menuItem.isAvailable) {
        throw new MenuValidationError(`menu item "${item.itemId}" is not available`);
      }
      return OrderItem.create({
        itemId: item.itemId,
        qty: item.qty,
        unitPriceCents: menuItem.priceCents,
      });
    });
  }
}
