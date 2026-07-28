import {
  chargePaymentCommand,
  INVENTORY_COMMANDS_TOPIC,
  PAYMENT_COMMANDS_TOPIC,
  releaseStockCommand,
  reserveStockCommand,
} from './saga-commands';

const orderId = '44444444-4444-4444-8444-444444444444';

describe('saga command factories', () => {
  it('reserveStockCommand targets inventory.commands, keyed by order id', () => {
    const items = [{ itemId: 'i-1', qty: 2 }];
    expect(reserveStockCommand(orderId, items)).toEqual({
      aggregateId: orderId,
      topic: INVENTORY_COMMANDS_TOPIC,
      eventType: 'ReserveStock',
      payload: { orderId, items },
    });
  });

  it('releaseStockCommand targets inventory.commands with just the order id', () => {
    expect(releaseStockCommand(orderId)).toEqual({
      aggregateId: orderId,
      topic: INVENTORY_COMMANDS_TOPIC,
      eventType: 'ReleaseStock',
      payload: { orderId },
    });
  });

  it('chargePaymentCommand targets payment.commands with the total', () => {
    expect(chargePaymentCommand(orderId, 1000)).toEqual({
      aggregateId: orderId,
      topic: PAYMENT_COMMANDS_TOPIC,
      eventType: 'ChargePayment',
      payload: { orderId, totalCents: 1000 },
    });
  });
});
