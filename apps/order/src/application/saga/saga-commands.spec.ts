import {
  chargePaymentCommand,
  INVENTORY_COMMANDS_TOPIC,
  PAYMENT_COMMANDS_TOPIC,
  releaseStockCommand,
  reserveStockCommand,
} from './saga-commands';

const orderId = '44444444-4444-4444-8444-444444444444';
const correlationId = '55555555-5555-4555-8555-555555555555';

describe('saga command factories', () => {
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
});
