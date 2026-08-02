import { OrderSaga } from '@order/domain/saga/order-saga';
import { IllegalSagaTransitionError } from '@order/domain/shared/errors';

const orderId = '44444444-4444-4444-8444-444444444444';
const tenantId = '11111111-1111-4111-8111-111111111111';
const eventId = '55555555-5555-4555-8555-555555555555';

function started(): OrderSaga {
  return OrderSaga.start({ orderId, tenantId });
}

describe('OrderSaga', () => {
  it('starts in STARTED at version 0 with no last event and a full attempts budget', () => {
    const saga = started();
    expect(saga.state).toBe('STARTED');
    expect(saga.version).toBe(0);
    expect(saga.lastEventId).toBeNull();
    expect(saga.attempts).toBe(0);
    expect(saga.isTerminal).toBe(false);
  });

  it('carries attempts through a transition unchanged (only the reconciler bumps it)', () => {
    const reserved = started().transition('STOCK_RESERVED', eventId);
    expect(reserved.attempts).toBe(0);
  });

  it('advances STARTED → STOCK_RESERVED → COMPLETED, recording the driving event', () => {
    const reserved = started().transition('STOCK_RESERVED', eventId);
    expect(reserved.state).toBe('STOCK_RESERVED');
    expect(reserved.lastEventId).toBe(eventId);

    const completed = reserved.transition('COMPLETED', eventId);
    expect(completed.state).toBe('COMPLETED');
    expect(completed.isTerminal).toBe(true);
  });

  it('supports the compensation path STOCK_RESERVED → COMPENSATING → CANCELLED', () => {
    const compensating = started()
      .transition('STOCK_RESERVED', eventId)
      .transition('COMPENSATING', eventId);
    expect(compensating.state).toBe('COMPENSATING');

    const cancelled = compensating.transition('CANCELLED', eventId);
    expect(cancelled.state).toBe('CANCELLED');
    expect(cancelled.isTerminal).toBe(true);
  });

  it('supports the stock-fail path STARTED → CANCELLED', () => {
    expect(started().transition('CANCELLED', eventId).state).toBe('CANCELLED');
  });

  it('rejects an illegal transition (STOCK_RESERVED → STARTED)', () => {
    const reserved = started().transition('STOCK_RESERVED', eventId);
    expect(() => reserved.transition('STARTED', eventId)).toThrow(IllegalSagaTransitionError);
  });

  it('rejects transitioning out of a terminal state', () => {
    const completed = started()
      .transition('STOCK_RESERVED', eventId)
      .transition('COMPLETED', eventId);
    expect(() => completed.transition('CANCELLED', eventId)).toThrow(IllegalSagaTransitionError);
  });

  it('rejects skipping straight from STARTED to COMPLETED', () => {
    expect(() => started().transition('COMPLETED', eventId)).toThrow(IllegalSagaTransitionError);
  });

  it('does not mutate the source instance on transition', () => {
    const saga = started();
    saga.transition('STOCK_RESERVED', eventId);
    expect(saga.state).toBe('STARTED');
  });
});
