import type { OutboxCommandEntry } from '@order/domain/shared/outbox.port';

/** Topics the saga orchestrator produces commands to (keyed by order id). */
export const INVENTORY_COMMANDS_TOPIC = 'inventory.commands';
export const PAYMENT_COMMANDS_TOPIC = 'payment.commands';

/** Command event type names carried in the `x-event-type` header. */
const RESERVE_STOCK = 'ReserveStock';
const RELEASE_STOCK = 'ReleaseStock';
const CHARGE_PAYMENT = 'ChargePayment';

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
