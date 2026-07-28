import type { OutboxCommandEntry } from '@inventory/domain/shared/outbox.port';

/** Topic inventory publishes saga replies to (keyed by order id). */
export const INVENTORY_REPLIES_TOPIC = 'inventory.replies';

/** Command event types inventory consumes on `inventory.commands`. */
export const RESERVE_STOCK = 'ReserveStock';
export const RELEASE_STOCK = 'ReleaseStock';

/** Reply event types inventory emits on `inventory.replies`. */
const STOCK_RESERVED = 'StockReserved';
const STOCK_RESERVATION_FAILED = 'StockReservationFailed';
const STOCK_RELEASED = 'StockReleased';

function reply(
  orderId: string,
  eventType: string,
  extra: Record<string, unknown> = {},
): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: INVENTORY_REPLIES_TOPIC,
    eventType,
    payload: { orderId, ...extra },
  };
}

export function stockReservedReply(orderId: string): OutboxCommandEntry {
  return reply(orderId, STOCK_RESERVED);
}

export function stockReservationFailedReply(orderId: string, reason: string): OutboxCommandEntry {
  return reply(orderId, STOCK_RESERVATION_FAILED, { reason });
}

export function stockReleasedReply(orderId: string): OutboxCommandEntry {
  return reply(orderId, STOCK_RELEASED);
}
