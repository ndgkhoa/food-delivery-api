import { randomUUID } from 'node:crypto';
import {
  chargePaymentCommand,
  releaseStockCommand,
  reserveStockCommand,
} from '@order/application/saga/saga-commands';
import type { Order } from '@order/domain/order/order';
import type { OrderSaga } from '@order/domain/saga/order-saga';
import type { OutboxCommandEntry } from '@order/domain/shared/outbox.port';

export type ReconcileAction =
  | { kind: 'redrive'; command: OutboxCommandEntry }
  | { kind: 'escalate' };

export function decideReconcileAction(
  saga: OrderSaga,
  order: Order,
  maxAttempts: number,
): ReconcileAction {
  if (saga.attempts >= maxAttempts) {
    return { kind: 'escalate' };
  }

  const correlationId = saga.correlationId ?? randomUUID();

  switch (saga.state) {
    case 'STARTED': {
      const items = order.items.map((item) => ({ itemId: item.itemId, qty: item.qty }));
      return {
        kind: 'redrive',
        command: reserveStockCommand(saga.orderId, items, correlationId),
      };
    }
    case 'STOCK_RESERVED':
      return {
        kind: 'redrive',
        command: chargePaymentCommand(saga.orderId, order.totalCents, correlationId),
      };
    case 'COMPENSATING':
      return {
        kind: 'redrive',
        command: releaseStockCommand(saga.orderId, correlationId),
      };
    default:
      throw new Error(`decideReconcileAction called for terminal saga state "${saga.state}"`);
  }
}
