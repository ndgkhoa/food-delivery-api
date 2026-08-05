import {
  chargePaymentCommand,
  INVENTORY_COMMANDS_TOPIC,
  ORDER_EVENTS_TOPIC,
  orderCancelledEvent,
  orderConfirmedEvent,
  PAYMENT_COMMANDS_TOPIC,
  releaseStockCommand,
  reserveStockCommand,
} from '@order/application/saga/saga-commands';

const orderId = '44444444-4444-4444-8444-444444444444';
const correlationId = '55555555-5555-4555-8555-555555555555';

describe('SagaCommandFactories', () => {
  it('reserveStockCommand targets inventory.commands, keyed by order id, carrying the root correlation id', () => {
    const items = [{ itemId: 'i-1', qty: 2 }];
    expect(reserveStockCommand(orderId, items, correlationId)).toEqual({
      aggregateId: orderId,
      topic: INVENTORY_COMMANDS_TOPIC,
      eventType: 'ReserveStock',
      payload: { orderId, items },
      correlationId,
    });
  });

  it('releaseStockCommand targets inventory.commands with just the order id + correlation id', () => {
    expect(releaseStockCommand(orderId, correlationId)).toEqual({
      aggregateId: orderId,
      topic: INVENTORY_COMMANDS_TOPIC,
      eventType: 'ReleaseStock',
      payload: { orderId },
      correlationId,
    });
  });

  it('chargePaymentCommand targets payment.commands with the total + correlation id', () => {
    expect(chargePaymentCommand(orderId, 1000, correlationId)).toEqual({
      aggregateId: orderId,
      topic: PAYMENT_COMMANDS_TOPIC,
      eventType: 'ChargePayment',
      payload: { orderId, totalCents: 1000 },
      correlationId,
    });
  });

  it('orderConfirmedEvent targets order.events with the CONFIRMED lifecycle payload, including restaurantId', () => {
    const userId = '77777777-7777-4777-8777-777777777777';
    const restaurantId = '88888888-8888-4888-8888-888888888888';
    expect(orderConfirmedEvent(orderId, userId, restaurantId, 1000, correlationId)).toEqual({
      aggregateId: orderId,
      topic: ORDER_EVENTS_TOPIC,
      eventType: 'OrderConfirmed',
      payload: { orderId, userId, restaurantId, status: 'CONFIRMED', totalCents: 1000 },
      correlationId,
    });
  });

  it('orderConfirmedEvent omits restaurantId (rather than emitting an empty string) for a straggler order that has none', () => {
    const userId = '77777777-7777-4777-8777-777777777777';
    expect(orderConfirmedEvent(orderId, userId, '', 1000, correlationId)).toEqual({
      aggregateId: orderId,
      topic: ORDER_EVENTS_TOPIC,
      eventType: 'OrderConfirmed',
      payload: { orderId, userId, status: 'CONFIRMED', totalCents: 1000 },
      correlationId,
    });
  });

  it('orderCancelledEvent targets order.events with the CANCELLED lifecycle payload', () => {
    const userId = '77777777-7777-4777-8777-777777777777';
    expect(orderCancelledEvent(orderId, userId, 1000, correlationId)).toEqual({
      aggregateId: orderId,
      topic: ORDER_EVENTS_TOPIC,
      eventType: 'OrderCancelled',
      payload: { orderId, userId, status: 'CANCELLED', totalCents: 1000 },
      correlationId,
    });
  });
});
