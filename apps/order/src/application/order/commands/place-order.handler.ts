import { randomUUID } from 'node:crypto';
import { recordOrderPlaced } from '@food-delivery-api/shared-observability';
import { SETTINGS_CLIENT, type SettingsClient } from '@food-delivery-api/shared-settings';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { reserveStockCommand } from '@order/application/saga/saga-commands';
import {
  IDEMPOTENCY_REPOSITORY,
  type IdempotencyRepository,
} from '@order/domain/idempotency/idempotency.repository';
import { Order, type OrderPricingInput } from '@order/domain/order/order';
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

export type OrderPricingSettingsClient = Pick<SettingsClient, 'getInt'>;

const DELIVERY_FEE_CONFIG_KEY = 'order.delivery_fee_cents';
const VAT_RATE_CONFIG_KEY = 'order.vat_rate_bps';
const DISCOUNT_CONFIG_KEY = 'order.discount_cents';

const DEFAULT_DELIVERY_FEE_CENTS = 1500;
const DEFAULT_VAT_RATE_BPS = 1000;
const DEFAULT_DISCOUNT_CENTS = 0;

const PG_UNIQUE_VIOLATION = '23505';

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

@Injectable()
export class PlaceOrderHandler {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(IDEMPOTENCY_REPOSITORY) private readonly idempotencyRepository: IdempotencyRepository,
    @Inject(ORDER_SAGA_REPOSITORY) private readonly sagaRepository: OrderSagaRepository,
    @Inject(CATALOG_GATEWAY_PORT) private readonly catalogGateway: CatalogGatewayPort,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    @Inject(SETTINGS_CLIENT) private readonly configClient: OrderPricingSettingsClient,
  ) {}

  private readonly logger = new Logger(PlaceOrderHandler.name);

  async execute(command: PlaceOrderCommand): Promise<Order> {
    assertValidCommand(command);

    const existingOrderId = await this.idempotencyRepository.findOrderId(
      command.tenantId,
      command.userId,
      command.idempotencyKey,
    );
    if (existingOrderId) {
      return this.loadExisting(command.tenantId, existingOrderId, command.idempotencyKey);
    }

    const { items: orderItems, restaurantId } = await this.buildOrderItems(command);
    const pricing = await this.resolvePricing(command.tenantId);
    const orderId = randomUUID();
    const correlationId = randomUUID();
    const pendingOrder = Order.create({
      id: orderId,
      tenantId: command.tenantId,
      userId: command.userId,
      restaurantId,
      items: orderItems,
      pricing,
    });

    if (pendingOrder.totalCents === 0) {
      this.logger.warn(
        `order ${orderId} totals 0 after a ${pricing.discountCents}-cent discount on ` +
          `subtotal ${pendingOrder.subtotalCents} — charging nothing`,
      );
    }

    try {
      const persistedOrder = await this.transaction.runInTransaction(async () => {
        await this.idempotencyRepository.save(
          command.tenantId,
          command.userId,
          command.idempotencyKey,
          orderId,
        );
        const inserted = await this.orderRepository.insert(pendingOrder);
        await this.sagaRepository.insert(
          OrderSaga.start({ orderId, tenantId: command.tenantId, correlationId }),
        );
        await this.outbox.append(
          reserveStockCommand(
            orderId,
            inserted.items.map((item) => ({ itemId: item.itemId, qty: item.qty })),
            correlationId,
          ),
        );
        return inserted;
      });
      recordOrderPlaced(persistedOrder.totalCents);
      return persistedOrder;
    } catch (error) {
      if (isUniqueViolation(error)) {
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

  private async resolvePricing(tenantId: string): Promise<OrderPricingInput> {
    const [deliveryFeeCents, vatRateBps, discountCents] = await Promise.all([
      this.configClient.getInt(DELIVERY_FEE_CONFIG_KEY, tenantId, DEFAULT_DELIVERY_FEE_CENTS),
      this.configClient.getInt(VAT_RATE_CONFIG_KEY, tenantId, DEFAULT_VAT_RATE_BPS),
      this.configClient.getInt(DISCOUNT_CONFIG_KEY, tenantId, DEFAULT_DISCOUNT_CENTS),
    ]);
    return { deliveryFeeCents, vatRateBps, discountCents };
  }

  private async buildOrderItems(
    command: PlaceOrderCommand,
  ): Promise<{ items: OrderItem[]; restaurantId: string }> {
    const distinctItemIds = [...new Set(command.items.map((item) => item.itemId))];
    const menuItems = await this.catalogGateway.validateItems(command.tenantId, distinctItemIds);
    const menuByItemId = new Map(menuItems.map((item) => [item.itemId, item]));

    const resolved = command.items.map((item) => {
      const menuItem = menuByItemId.get(item.itemId);
      if (!menuItem) {
        throw new MenuValidationError(`menu item "${item.itemId}" not found for this tenant`);
      }
      if (!menuItem.isAvailable) {
        throw new MenuValidationError(`menu item "${item.itemId}" is not available`);
      }
      return {
        restaurantId: menuItem.restaurantId,
        orderItem: OrderItem.create({
          itemId: item.itemId,
          qty: item.qty,
          unitPriceCents: menuItem.priceCents,
        }),
      };
    });

    const distinctRestaurantIds = [...new Set(resolved.map((entry) => entry.restaurantId))];
    if (distinctRestaurantIds.length > 1) {
      throw new InvalidOrderRequestError('an order cannot span multiple restaurants');
    }

    return {
      items: resolved.map((entry) => entry.orderItem),
      restaurantId: distinctRestaurantIds[0],
    };
  }
}
