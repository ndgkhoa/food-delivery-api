import { Logger } from '@nestjs/common';
import { type Counter, type Histogram, metrics } from '@opentelemetry/api';

const logger = new Logger('Telemetry');
const METER_NAME = 'food-delivery';

export type SagaOutcome = 'confirmed' | 'cancelled';

export type BullmqJobOutcome = 'completed' | 'failed';

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

function sagaReconcileRedriven(): Counter {
  return meter().createCounter('saga_reconcile_redriven_total', {
    description:
      'Count of stranded sagas re-driven by the reconciler (idempotent command re-emitted), by the state re-driven from.',
  });
}

function sagaReconcileEscalated(): Counter {
  return meter().createCounter('saga_reconcile_escalated_total', {
    description:
      'Count of stranded sagas escalated (reconcile-attempts cap reached) instead of re-driven again.',
  });
}

function bullmqJobDuration(): Histogram {
  return meter().createHistogram('bullmq_job_duration_ms', {
    description: 'Duration of a processed BullMQ job (enqueue -> processed), by queue and outcome.',
    unit: 'ms',
  });
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function recordOrderPlaced(revenueCents: number): void {
  try {
    orderPlaced().add(1);
    orderRevenue().add(revenueCents);
  } catch (error) {
    logger.warn(`failed to record order-placed metric: ${reasonOf(error)}`);
  }
}

export function recordSagaOutcome(outcome: SagaOutcome): void {
  try {
    sagaOutcome().add(1, { outcome });
  } catch (error) {
    logger.warn(`failed to record saga-outcome metric: ${reasonOf(error)}`);
  }
}

export function recordDlqMessage(topic: string): void {
  try {
    dlqMessage().add(1, { topic });
  } catch (error) {
    logger.warn(`failed to record dlq-message metric: ${reasonOf(error)}`);
  }
}

export function recordSagaReconcileRedriven(state: string): void {
  try {
    sagaReconcileRedriven().add(1, { state });
  } catch (error) {
    logger.warn(`failed to record saga-reconcile-redriven metric: ${reasonOf(error)}`);
  }
}

export function recordSagaReconcileEscalated(): void {
  try {
    sagaReconcileEscalated().add(1);
  } catch (error) {
    logger.warn(`failed to record saga-reconcile-escalated metric: ${reasonOf(error)}`);
  }
}

export function recordBullmqJob(
  queue: string,
  outcome: BullmqJobOutcome,
  durationMs: number,
): void {
  try {
    bullmqJobDuration().record(durationMs, { queue, outcome });
  } catch (error) {
    logger.warn(`failed to record bullmq-job metric: ${reasonOf(error)}`);
  }
}
