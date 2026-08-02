import { Logger } from '@nestjs/common';
import { type Counter, metrics } from '@opentelemetry/api';

const logger = new Logger('Telemetry');
const METER_NAME = 'food-delivery';

/** Valid terminal outcomes for the order saga — the only values the `outcome` label may take. */
export type SagaOutcome = 'confirmed' | 'cancelled';

/**
 * Resolves the meter — and every instrument off it — freshly on EVERY call
 * rather than caching at module scope: `register.ts` registers the real
 * meter provider on a service's first `registerTracing()` call, which can run
 * AFTER this module is first imported — a `Counter` handed out by the no-op
 * meter (the default before a provider is registered) stays a no-op forever,
 * it does not "upgrade" once the real provider shows up. Mirrors the same
 * per-call-resolution discipline `kafka-trace-propagation.ts` uses for its
 * tracer. Cheap either way: the OTel SDK returns the SAME underlying
 * instrument for a repeated `createCounter` call with the same name.
 */
function meter() {
  return metrics.getMeter(METER_NAME);
}

function orderPlaced(): Counter {
  return meter().createCounter('orders_placed_total', {
    description: 'Count of orders successfully placed (saga started).',
  });
}

function orderRevenue(): Counter {
  return meter().createCounter('order_revenue_cents_total', {
    description: 'Sum of order totals (cents) at placement time.',
    unit: 'cents',
  });
}

function sagaOutcome(): Counter {
  return meter().createCounter('saga_outcome_total', {
    description: 'Count of order sagas reaching a terminal outcome, by outcome.',
  });
}

function dlqMessage(): Counter {
  return meter().createCounter('dlq_messages_total', {
    description: 'Count of messages routed to a dead-letter topic, by source topic.',
  });
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Records an order placement: increments `orders_placed_total` and adds the
 * order's total (cents) to `order_revenue_cents_total`. Recorded at PLACEMENT
 * (not saga confirmation) — the order is durably committed at this point, and
 * placement is the single call site every successful `PlaceOrderHandler.execute`
 * passes through exactly once. No order id / tenant id label (cardinality).
 * Never throws: a down Collector or a broken meter must never fail order
 * placement.
 */
export function recordOrderPlaced(revenueCents: number): void {
  try {
    orderPlaced().add(1);
    orderRevenue().add(revenueCents);
  } catch (error) {
    logger.warn(`failed to record order-placed metric: ${reasonOf(error)}`);
  }
}

/**
 * Records a saga reaching a terminal state (`confirmed` on payment success,
 * `cancelled` on either compensation leg). `outcome` is the ONLY label — a
 * fixed 2-value domain, safe for a Prometheus label. Never throws.
 */
export function recordSagaOutcome(outcome: SagaOutcome): void {
  try {
    sagaOutcome().add(1, { outcome });
  } catch (error) {
    logger.warn(`failed to record saga-outcome metric: ${reasonOf(error)}`);
  }
}

/**
 * Records a message routed to its dead-letter topic, labelled by the
 * ORIGINAL source topic (not the `.dlq` topic name) — bounded by the fixed
 * set of topics this system publishes, never by message/order id. Never
 * throws: a down Collector must never block the DLQ-publish path.
 */
export function recordDlqMessage(topic: string): void {
  try {
    dlqMessage().add(1, { topic });
  } catch (error) {
    logger.warn(`failed to record dlq-message metric: ${reasonOf(error)}`);
  }
}
