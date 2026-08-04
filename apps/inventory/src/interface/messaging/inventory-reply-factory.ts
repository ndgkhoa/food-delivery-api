import type { OutboxCommandEntry } from '@inventory/domain/shared/outbox.port';

export const INVENTORY_REPLIES_TOPIC = 'inventory.replies';

export const RESERVE_STOCK = 'ReserveStock';
export const RELEASE_STOCK = 'ReleaseStock';

const STOCK_RESERVED = 'StockReserved';
const STOCK_RESERVATION_FAILED = 'StockReservationFailed';
const STOCK_RELEASED = 'StockReleased';

function reply(
  orderId: string,
  eventType: string,
  correlationId: string,
  extra: Record<string, unknown> = {},
): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: INVENTORY_REPLIES_TOPIC,
    eventType,
    payload: { orderId, ...extra },
    correlationId,
  };
}

export function stockReservedReply(orderId: string, correlationId: string): OutboxCommandEntry {
  return reply(orderId, STOCK_RESERVED, correlationId);
}

export function stockReservationFailedReply(
  orderId: string,
  reason: string,
  correlationId: string,
): OutboxCommandEntry {
  return reply(orderId, STOCK_RESERVATION_FAILED, correlationId, { reason });
}

export function stockReleasedReply(orderId: string, correlationId: string): OutboxCommandEntry {
  return reply(orderId, STOCK_RELEASED, correlationId);
}
