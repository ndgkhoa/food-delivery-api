import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  IDEMPOTENCY_REPOSITORY,
  type IdempotencyRepository,
} from '@order/domain/idempotency/idempotency.repository';
import { Order } from '@order/domain/order/order';
import { ORDER_REPOSITORY, type OrderRepository } from '@order/domain/order/order.repository';
import { OrderItem } from '@order/domain/order/order-item';
import {
  CATALOG_GATEWAY_PORT,
  type CatalogGatewayPort,
} from '@order/domain/shared/catalog-gateway.port';
import {
  IdempotencyConflictError,
  InsufficientStockError,
  InvalidOrderRequestError,
  MenuValidationError,
} from '@order/domain/shared/errors';
import {
  INVENTORY_GATEWAY_PORT,
  type InventoryGatewayPort,
} from '@order/domain/shared/inventory-gateway.port';
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
 * Places an order as a synchronous saga over gRPC. Correctness hinges on making
 * the order durable BEFORE any external effect: the idempotency-key claim and a
 * PENDING order row are written in ONE transaction, then stock is reserved and
 * the order transitioned to RESERVED (or CANCELLED). Because the order row
 * always exists once the key is claimed, a retry after any failure re-drives the
 * saga — inventory.reserve is idempotent by orderId — instead of wedging on a
 * claimed-but-orderless key or stranding a reserved hold. This inline coupling
 * is deliberate for this slice; P3 replaces it with a Kafka saga + outbox.
 */
@Injectable()
export class PlaceOrderHandler {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(IDEMPOTENCY_REPOSITORY) private readonly idempotencyRepository: IdempotencyRepository,
    @Inject(CATALOG_GATEWAY_PORT) private readonly catalogGateway: CatalogGatewayPort,
    @Inject(INVENTORY_GATEWAY_PORT) private readonly inventoryGateway: InventoryGatewayPort,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<Order> {
    assertValidCommand(command);

    // 1. Replay: an existing key maps to a durable order — resume it (re-driving
    //    a still-PENDING one) rather than starting over.
    const existingOrderId = await this.idempotencyRepository.findOrderId(
      command.tenantId,
      command.userId,
      command.idempotencyKey,
    );
    if (existingOrderId) {
      return this.resumeExisting(command.tenantId, existingOrderId, command.idempotencyKey);
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

    // 3. Durably record intent: claim the key AND insert the PENDING order in ONE
    //    transaction, so a later failure can never leave a claimed key without a
    //    recoverable order row. Keep the persisted order — it carries the DB's
    //    authoritative version the optimistic-lock transition needs.
    let persistedOrder: Order;
    try {
      persistedOrder = await this.transaction.runInTransaction(async () => {
        await this.idempotencyRepository.save(
          command.tenantId,
          command.userId,
          command.idempotencyKey,
          orderId,
        );
        return this.orderRepository.insert(pendingOrder);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A concurrent request won the key; its order committed atomically with
        // the claim, so resume that one.
        return this.resolveConcurrentClaim(
          command.tenantId,
          command.userId,
          command.idempotencyKey,
        );
      }
      throw error;
    }

    // 4. Drive the reservation. Idempotent by orderId, so a retry re-drives safely.
    return this.driveReservation(persistedOrder);
  }

  private async resumeExisting(
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
    return order.status === 'PENDING' ? this.driveReservation(order) : order;
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
      return this.resumeExisting(tenantId, winningOrderId, idempotencyKey);
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

  /**
   * Reserve stock for a PENDING order, then transition it. Safe to call again on
   * a retry: inventory.reserve is idempotent by orderId, and the optimistic-lock
   * transition either wins or 409s a concurrent driver (which then resumes).
   */
  private async driveReservation(order: Order): Promise<Order> {
    const reserveResult = await this.inventoryGateway.reserve(
      order.tenantId,
      order.id,
      order.items.map((item) => ({ itemId: item.itemId, qty: item.qty })),
    );
    if (!reserveResult.ok) {
      await this.orderRepository.updateStatus(order.cancel());
      throw new InsufficientStockError(order.id);
    }
    return this.orderRepository.updateStatus(order.reserve());
  }
}
