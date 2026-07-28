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
 */
export function reserveStockCommand(orderId: string, items: SagaReserveItem[]): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: INVENTORY_COMMANDS_TOPIC,
    eventType: RESERVE_STOCK,
    payload: { orderId, items },
  };
}

/** Builds the compensation command: release a previously reserved hold. */
export function releaseStockCommand(orderId: string): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: INVENTORY_COMMANDS_TOPIC,
    eventType: RELEASE_STOCK,
    payload: { orderId },
  };
}

/** Builds the charge command handed to the payment stub after stock is reserved. */
export function chargePaymentCommand(orderId: string, totalCents: number): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: PAYMENT_COMMANDS_TOPIC,
    eventType: CHARGE_PAYMENT,
    payload: { orderId, totalCents },
  };
}
