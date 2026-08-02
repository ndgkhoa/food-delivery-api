import { randomUUID } from 'node:crypto';
import {
  chargePaymentCommand,
  releaseStockCommand,
  reserveStockCommand,
} from '@order/application/saga/saga-commands';
import type { Order } from '@order/domain/order/order';
import type { OrderSaga } from '@order/domain/saga/order-saga';
import type { OutboxCommandEntry } from '@order/domain/shared/outbox.port';

/** Outcome of `decideReconcileAction`: either re-drive with a specific command, or give up and escalate. */
export type ReconcileAction =
  | { kind: 'redrive'; command: OutboxCommandEntry }
  | { kind: 'escalate' };

/**
 * Pure decision rule for the stranded-saga reconciler — the single source of
 * truth for "what command re-drives a saga stuck in this state", mirroring how
 * `selectStrandedSagas` is the single source of truth for "is this saga
 * stranded". Lives in the application layer (not domain) because it composes
 * `saga-commands.ts`, which the placement/reply handlers already treat as an
 * application-layer building block.
 *
 * At or past `maxAttempts` the saga is escalated instead of re-driven again —
 * a per-saga LIFETIME budget, not reset per stage (kept simple on purpose):
 * the only thing that resets the clock is a real reply advancing the saga to
 * a new state, or to terminal where it is never swept again.
 */
export function decideReconcileAction(
  saga: OrderSaga,
  order: Order,
  maxAttempts: number,
): ReconcileAction {
  if (saga.attempts >= maxAttempts) {
    return { kind: 'escalate' };
  }

  // A stranded saga always carries the root correlation id minted at saga
  // start; a fresh id is only ever needed defensively here, mirroring how the
  // outbox adapter mints one for a null `correlationId` on append.
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
      // `selectStrandedSagas` excludes terminal states before a candidate ever
      // reaches here — reaching this branch means a caller bypassed that
      // selection, which is a programming error worth failing loudly on.
      throw new Error(`decideReconcileAction called for terminal saga state "${saga.state}"`);
  }
}
