import type { OutboxCommandEntry } from '@order/domain/shared/outbox.port';

/** Topics the saga orchestrator produces commands to (keyed by order id). */
export const INVENTORY_COMMANDS_TOPIC = 'inventory.commands';
export const PAYMENT_COMMANDS_TOPIC = 'payment.commands';
/**
 * Lifecycle topic the order publishes its own domain events to when the saga
 * finalizes — one row per outcome, keyed by order id. Downstream contexts
 * (delivery driver-assignment, analytics/notification) subscribe here; the order
 * itself never consumes it.
 */
export const ORDER_EVENTS_TOPIC = 'order.events';

/** Command event type names carried in the `x-event-type` header. */
const RESERVE_STOCK = 'ReserveStock';
const RELEASE_STOCK = 'ReleaseStock';
const CHARGE_PAYMENT = 'ChargePayment';
/** Lifecycle event type names published to `order.events`. */
const ORDER_CONFIRMED = 'OrderConfirmed';
const ORDER_CANCELLED = 'OrderCancelled';

export interface SagaReserveItem {
  itemId: string;
  qty: number;
}

/**
 * Builds the first saga command: ask inventory to reserve stock for the order.
 * Pure — returns an outbox entry the caller appends inside its transaction.
 * `correlationId` is the saga's ROOT trace id (minted once by place-order) that
 * every downstream command/reply carries.
 */
export function reserveStockCommand(
  orderId: string,
  items: SagaReserveItem[],
  correlationId: string,
): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: INVENTORY_COMMANDS_TOPIC,
    eventType: RESERVE_STOCK,
    payload: { orderId, items },
    correlationId,
  };
}

/**
 * Builds the compensation command: release a previously reserved hold.
 * `correlationId` is threaded from the triggering PaymentFailed reply so the
 * compensation leg stays on the same saga trace.
 */
export function releaseStockCommand(orderId: string, correlationId: string): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: INVENTORY_COMMANDS_TOPIC,
    eventType: RELEASE_STOCK,
    payload: { orderId },
    correlationId,
  };
}

/**
 * Builds the charge command handed to the payment stub after stock is reserved.
 * `correlationId` is threaded from the triggering StockReserved reply.
 */
export function chargePaymentCommand(
  orderId: string,
  totalCents: number,
  correlationId: string,
): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: PAYMENT_COMMANDS_TOPIC,
    eventType: CHARGE_PAYMENT,
    payload: { orderId, totalCents },
    correlationId,
  };
}

/** Order lifecycle payload every `order.events` row carries. */
interface OrderLifecyclePayload {
  orderId: string;
  userId: string;
  status: 'CONFIRMED' | 'CANCELLED';
  totalCents: number;
}

/**
 * Builds the `OrderConfirmed` lifecycle event appended when the saga completes.
 * `correlationId` is threaded from the triggering PaymentSucceeded reply so the
 * emission stays on the saga's trace. Appended in the SAME transaction as the
 * order-status + saga transition, so an order can never appear CONFIRMED without
 * its event (and vice versa).
 */
export function orderConfirmedEvent(
  orderId: string,
  userId: string,
  totalCents: number,
  correlationId: string,
): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: ORDER_EVENTS_TOPIC,
    eventType: ORDER_CONFIRMED,
    payload: { orderId, userId, status: 'CONFIRMED', totalCents } satisfies OrderLifecyclePayload,
    correlationId,
  };
}

/**
 * Builds the `OrderCancelled` lifecycle event appended when the saga cancels the
 * order (stock reservation failed, or the compensating release completed).
 * `correlationId` is threaded from the triggering reply. Appended atomically with
 * the cancel transition.
 */
export function orderCancelledEvent(
  orderId: string,
  userId: string,
  totalCents: number,
  correlationId: string,
): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: ORDER_EVENTS_TOPIC,
    eventType: ORDER_CANCELLED,
    payload: { orderId, userId, status: 'CANCELLED', totalCents } satisfies OrderLifecyclePayload,
    correlationId,
  };
}
