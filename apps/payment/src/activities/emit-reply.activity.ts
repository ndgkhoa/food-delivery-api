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

export interface EmitReplyActivityDeps {
  outbox: OutboxWriter;
  transaction: TransactionPort;
  processedEvents: ProcessedEventStorePort;
  tenantContext: TenantContextPort;
}

export function createEmitReplyActivity(
  deps: EmitReplyActivityDeps,
): (input: EmitReplyActivityInput) => Promise<void> {
  return async (input) => {
    const reply = input.ok
      ? paymentSucceededReply(input.orderId, input.correlationId)
      : paymentFailedReply(input.orderId, input.reason ?? 'payment declined', input.correlationId);

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
