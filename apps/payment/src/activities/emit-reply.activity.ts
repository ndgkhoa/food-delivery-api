import {
  IdempotentConsumer,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import { runWithTraceParent } from '@food-delivery-api/shared-observability';
import type { TenantContextPort } from '@food-delivery-api/shared-tenancy';
import type { OutboxWriter } from '@payment/domain/shared/outbox.port';
import type { TransactionPort } from '@payment/domain/shared/transaction.port';
import {
  paymentFailedReply,
  paymentSucceededReply,
} from '@payment/interface/messaging/payment-reply-factory';
import type { EmitReplyActivityInput } from '@payment/workflows/charge-workflow.types';
import { log } from '@temporalio/activity';

/** Deps the emit-reply activity closes over — all IO happens here, never in the workflow. */
export interface EmitReplyActivityDeps {
  outbox: OutboxWriter;
  transaction: TransactionPort;
  processedEvents: ProcessedEventStorePort;
  tenantContext: TenantContextPort;
}

/**
 * Builds the `emitReply` activity. It writes `PaymentSucceeded`/`PaymentFailed`
 * to the payment outbox (the existing relay then publishes to `payment.replies`)
 * inside a transaction, under the tenant scope carried from the command. Temporal
 * runs activities at-least-once, so the write is deduped by order id via the
 * processed-events ledger: a retried activity finds the marker and skips the
 * second append — the saga therefore sees exactly one reply per charge.
 */
export function createEmitReplyActivity(
  deps: EmitReplyActivityDeps,
): (input: EmitReplyActivityInput) => Promise<void> {
  return async (input) => {
    const reply = input.ok
      ? paymentSucceededReply(input.orderId, input.correlationId)
      : paymentFailedReply(input.orderId, input.reason ?? 'payment declined', input.correlationId);

    // Re-activate the originating trace (Temporal detached it) so the outbox
    // writer's own trace-context capture records the saga's trace id on the reply
    // row — the relay then forwards it and the whole tail joins one trace.
    await runWithTraceParent(input.traceParent, () =>
      deps.tenantContext.run({ tenantId: input.tenantId, actor: 'system', roles: [] }, () =>
        deps.transaction.runInTransaction(() =>
          IdempotentConsumer.runOnce(deps.processedEvents, input.orderId, undefined, () =>
            deps.outbox.append(reply),
          ),
        ),
      ),
    );
    log.info('payment reply emitted', { orderId: input.orderId, ok: input.ok });
  };
}
