import { randomUUID } from 'node:crypto';
import { CONFIG_CLIENT, type ConfigClient } from '@food-delivery-api/shared-config-client';
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

/** The only method this handler needs from `ConfigClient` — narrows the DI type so tests need a minimal fake. */
export type OrderPricingConfigClient = Pick<ConfigClient, 'getInt'>;

/** Config keys the order's tenant may override; the second argument to each `getInt` call is the fallback. */
const DELIVERY_FEE_CONFIG_KEY = 'order.delivery_fee_cents';
const VAT_RATE_CONFIG_KEY = 'order.vat_rate_bps';
const DISCOUNT_CONFIG_KEY = 'order.discount_cents';

const DEFAULT_DELIVERY_FEE_CENTS = 1500;
const DEFAULT_VAT_RATE_BPS = 1000;
const DEFAULT_DISCOUNT_CENTS = 0;

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
    @Inject(CONFIG_CLIENT) private readonly configClient: OrderPricingConfigClient,
  ) {}

  private readonly logger = new Logger(PlaceOrderHandler.name);

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
    // config-client never throws (cold miss / config service down falls back to
    // the default here, WARN-logged) — placing an order never blocks on config.
    const pricing = await this.resolvePricing(command.tenantId);
    const orderId = randomUUID();
    // Root trace id for the whole saga: it rides the first ReserveStock command
    // and is carried through every reply + follow-on command so the saga's
    // events can be traced end to end.
    const correlationId = randomUUID();
    const pendingOrder = Order.create({
      id: orderId,
      tenantId: command.tenantId,
      userId: command.userId,
      items: orderItems,
      pricing,
    });

    // A discount that meets or exceeds subtotal+fee+VAT floors the charge to 0
    // (allowed — a full-value promo is legitimate), but a 0-total order is worth
    // an ops signal so a mis-set discount isn't mistaken for normal free orders.
    if (pendingOrder.totalCents === 0) {
      this.logger.warn(
        `order ${orderId} totals 0 after a ${pricing.discountCents}-cent discount on ` +
          `subtotal ${pendingOrder.subtotalCents} — charging nothing`,
      );
    }

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
        await this.sagaRepository.insert(
          OrderSaga.start({ orderId, tenantId: command.tenantId, correlationId }),
        );
        await this.outbox.append(
          reserveStockCommand(
            orderId,
            persistedOrder.items.map((item) => ({ itemId: item.itemId, qty: item.qty })),
            correlationId,
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

  /** Reads the tenant's delivery-fee/VAT/discount tunables from config, each falling back to its documented default. */
  private async resolvePricing(tenantId: string): Promise<OrderPricingInput> {
    const [deliveryFeeCents, vatRateBps, discountCents] = await Promise.all([
      this.configClient.getInt(DELIVERY_FEE_CONFIG_KEY, tenantId, DEFAULT_DELIVERY_FEE_CENTS),
      this.configClient.getInt(VAT_RATE_CONFIG_KEY, tenantId, DEFAULT_VAT_RATE_BPS),
      this.configClient.getInt(DISCOUNT_CONFIG_KEY, tenantId, DEFAULT_DISCOUNT_CENTS),
    ]);
    return { deliveryFeeCents, vatRateBps, discountCents };
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
