import {
  INVENTORY_REPLIES_TOPIC,
  stockReleasedReply,
  stockReservationFailedReply,
  stockReservedReply,
} from './inventory-reply-factory';

const orderId = '44444444-4444-4444-8444-444444444444';

describe('inventory reply factory', () => {
  it('maps a successful reserve to StockReserved keyed by order id', () => {
    expect(stockReservedReply(orderId)).toEqual({
      aggregateId: orderId,
      topic: INVENTORY_REPLIES_TOPIC,
      eventType: 'StockReserved',
      payload: { orderId },
    });
  });

  it('maps a failed reserve to StockReservationFailed with a reason', () => {
    expect(stockReservationFailedReply(orderId, 'insufficient stock')).toEqual({
      aggregateId: orderId,
      topic: INVENTORY_REPLIES_TOPIC,
      eventType: 'StockReservationFailed',
      payload: { orderId, reason: 'insufficient stock' },
    });
  });

  it('maps a release to StockReleased', () => {
    expect(stockReleasedReply(orderId)).toEqual({
      aggregateId: orderId,
      topic: INVENTORY_REPLIES_TOPIC,
      eventType: 'StockReleased',
      payload: { orderId },
    });
  });
});
