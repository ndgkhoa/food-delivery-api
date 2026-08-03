import {
  INVENTORY_REPLIES_TOPIC,
  stockReleasedReply,
  stockReservationFailedReply,
  stockReservedReply,
} from './inventory-reply-factory';

const orderId = '44444444-4444-4444-8444-444444444444';
const correlationId = '55555555-5555-4555-8555-555555555555';

describe('inventory reply factory', () => {
  it('maps a successful reserve to StockReserved keyed by order id, carrying the command correlation id', () => {
    expect(stockReservedReply(orderId, correlationId)).toEqual({
      aggregateId: orderId,
      topic: INVENTORY_REPLIES_TOPIC,
      eventType: 'StockReserved',
      payload: { orderId },
      correlationId,
    });
  });

  it('maps a failed reserve to StockReservationFailed with a reason + correlation id', () => {
    expect(stockReservationFailedReply(orderId, 'insufficient stock', correlationId)).toEqual({
      aggregateId: orderId,
      topic: INVENTORY_REPLIES_TOPIC,
      eventType: 'StockReservationFailed',
      payload: { orderId, reason: 'insufficient stock' },
      correlationId,
    });
  });

  it('maps a release to StockReleased carrying the correlation id', () => {
    expect(stockReleasedReply(orderId, correlationId)).toEqual({
      aggregateId: orderId,
      topic: INVENTORY_REPLIES_TOPIC,
      eventType: 'StockReleased',
      payload: { orderId },
      correlationId,
    });
  });
});
