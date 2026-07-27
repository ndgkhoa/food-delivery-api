import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { claimIdempotencyKey } from '@order/application/order/commands/claim-idempotency-key';
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
 * Places an order as a synchronous saga over gRPC: validate menu (catalog) →
 * claim the idempotency key → reserve stock (inventory) → persist. This
 * inline coupling is deliberate for this slice — P3 replaces it with a Kafka
 * saga + outbox so a downstream failure no longer blocks the caller.
 */
@Injectable()
export class PlaceOrderHandler {
  private readonly logger = new Logger(PlaceOrderHandler.name);

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(IDEMPOTENCY_REPOSITORY) private readonly idempotencyRepository: IdempotencyRepository,
    @Inject(CATALOG_GATEWAY_PORT) private readonly catalogGateway: CatalogGatewayPort,
    @Inject(INVENTORY_GATEWAY_PORT) private readonly inventoryGateway: InventoryGatewayPort,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<Order> {
    assertValidCommand(command);

    // 1. Idempotency replay: an identical retry returns the original order.
    const existingOrderId = await this.idempotencyRepository.findOrderId(
      command.tenantId,
      command.userId,
      command.idempotencyKey,
    );
    if (existingOrderId) {
      return this.loadReplayedOrder(command.tenantId, existingOrderId, command.idempotencyKey);
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

    // 3. Claim the idempotency key FIRST so a client retry (before reserve/persist finish)
    // reuses this same orderId — inventory.reserve is idempotent by orderId.
    await claimIdempotencyKey(
      this.idempotencyRepository,
      this.orderRepository,
      command.tenantId,
      command.userId,
      command.idempotencyKey,
      orderId,
    );

    // 4. Reserve stock. ok=false → persist a CANCELLED order (audit trail) and reject.
    const reserveResult = await this.inventoryGateway.reserve(
      command.tenantId,
      orderId,
      orderItems.map((item) => ({ itemId: item.itemId, qty: item.qty })),
    );
    if (!reserveResult.ok) {
      await this.orderRepository.save(pendingOrder.cancel());
      throw new InsufficientStockError(orderId);
    }

    return this.persistReserved(pendingOrder, command.tenantId, orderId);
  }

  private async loadReplayedOrder(
    tenantId: string,
    orderId: string,
    idempotencyKey: string,
  ): Promise<Order> {
    const existing = await this.orderRepository.findById(tenantId, orderId);
    if (existing) {
      return existing;
    }
    // The mapping was claimed but the owning request hasn't persisted the order row
    // yet (a race with a concurrent in-flight place-order). Retryable — 409.
    throw new IdempotencyConflictError(
      `order for key "${idempotencyKey}" is still being created — retry shortly`,
    );
  }

  private async buildOrderItems(command: PlaceOrderCommand): Promise<OrderItem[]> {
    const distinctItemIds = [...new Set(command.items.map((item) => item.itemId))];
    const menuItems = await this.catalogGateway.validateItems(command.tenantId, distinctItemIds);
    const menuByItemId = new Map(menuItems.map((item) => [item.itemId, item]));

    for (const itemId of distinctItemIds) {
      const menuItem = menuByItemId.get(itemId);
      if (!menuItem) {
        throw new MenuValidationError(`menu item "${itemId}" not found for this tenant`);
      }
      if (!menuItem.isAvailable) {
        throw new MenuValidationError(`menu item "${itemId}" is not available`);
      }
    }

    return command.items.map((item) => {
      // Presence already verified in the loop above — `.priceCents` defaults to 0
      // only if that invariant is ever violated, which `OrderItem.create` still
      // guards (non-negative integer check).
      const priceCents = menuByItemId.get(item.itemId)?.priceCents ?? 0;
      return OrderItem.create({ itemId: item.itemId, qty: item.qty, unitPriceCents: priceCents });
    });
  }

  private async persistReserved(
    pendingOrder: Order,
    tenantId: string,
    orderId: string,
  ): Promise<Order> {
    const reserved = pendingOrder.reserve();
    try {
      return await this.transaction.runInTransaction(() => this.orderRepository.save(reserved));
    } catch (error) {
      // Reserve succeeded but the local persist failed — compensate by releasing the
      // hold we just took, best-effort, then rethrow the original failure.
      try {
        await this.inventoryGateway.release(tenantId, orderId);
      } catch (releaseError) {
        this.logger.error(
          `compensating release failed for order "${orderId}" after a failed persist — stock may remain held until manually reconciled`,
          releaseError instanceof Error ? releaseError.stack : String(releaseError),
        );
      }
      throw error;
    }
  }
}
