import type { OutboxCommandEntry } from '@order/domain/shared/outbox.port';

export const INVENTORY_COMMANDS_TOPIC = 'inventory.commands';
export const PAYMENT_COMMANDS_TOPIC = 'payment.commands';
export const ORDER_EVENTS_TOPIC = 'order.events';

const RESERVE_STOCK = 'ReserveStock';
const RELEASE_STOCK = 'ReleaseStock';
const CHARGE_PAYMENT = 'ChargePayment';
const ORDER_CONFIRMED = 'OrderConfirmed';
const ORDER_CANCELLED = 'OrderCancelled';

export interface SagaReserveItem {
  itemId: string;
  qty: number;
}

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

export function releaseStockCommand(orderId: string, correlationId: string): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: INVENTORY_COMMANDS_TOPIC,
    eventType: RELEASE_STOCK,
    payload: { orderId },
    correlationId,
  };
}

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

interface OrderLifecyclePayload {
  orderId: string;
  userId: string;
  status: 'CONFIRMED' | 'CANCELLED';
  totalCents: number;
  restaurantId?: string;
}

export function orderConfirmedEvent(
  orderId: string,
  userId: string,
  restaurantId: string,
  totalCents: number,
  correlationId: string,
): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: ORDER_EVENTS_TOPIC,
    eventType: ORDER_CONFIRMED,
    payload: {
      orderId,
      userId,
      status: 'CONFIRMED',
      totalCents,
      ...(restaurantId ? { restaurantId } : {}),
    } satisfies OrderLifecyclePayload,
    correlationId,
  };
}

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
