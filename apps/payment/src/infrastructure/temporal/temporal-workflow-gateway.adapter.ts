import { captureActiveTraceContext } from '@food-delivery-api/shared-observability';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OUTBOX_WRITER, type OutboxWriter } from '@payment/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@payment/domain/shared/transaction.port';
import type { WorkflowGatewayPort } from '@payment/domain/shared/workflow-gateway.port';
import { WORKFLOW_CLIENT } from '@payment/infrastructure/temporal/temporal.tokens';
import {
  paymentFailedReply,
  paymentSucceededReply,
} from '@payment/interface/messaging/payment-reply-factory';
import {
  CHARGE_WORKFLOW_TYPE,
  type ChargeWorkflowInput,
  PROVIDER_RESULT_SIGNAL,
  type ProviderResult,
} from '@payment/workflows/charge-workflow.types';
import {
  WorkflowClient,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';

/** Deterministic per-order workflow id → Temporal dedupes concurrent/redelivered starts. */
function chargeWorkflowId(orderId: string): string {
  return `charge-${orderId}`;
}

/**
 * Temporal-backed `WorkflowGatewayPort`. Starts the charge workflow keyed by
 * order id. `REJECT_DUPLICATE` reuse means Temporal rejects a second start of the
 * same id whether the first run is still OPEN or already CLOSED (within retention),
 * so a `ChargePayment` redelivered after the workflow completes raises
 * `WorkflowExecutionAlreadyStartedError`. That redelivery is exactly how the order
 * saga's stranded-saga reconciler recovers a STOCK_RESERVED saga whose payment
 * reply never arrived: the reconciler re-emits `ChargePayment`, `startCharge` hits
 * the duplicate-start error, and — because the run already reached COMPLETED — this
 * adapter re-appends its already-decided outcome to the payment outbox under a
 * FRESH event id so the order side's dedupe-by-event-id reply consumer reprocesses
 * it. `REJECT_DUPLICATE` guarantees the charge activity itself never runs a second
 * time; only the REPLY is ever re-emitted. A run still RUNNING emits its own reply
 * when it finishes, so a duplicate start against it stays a plain no-op.
 * Signals route an async provider result from the webhook to the waiting workflow.
 */
@Injectable()
export class TemporalWorkflowGatewayAdapter implements WorkflowGatewayPort {
  private readonly logger = new Logger(TemporalWorkflowGatewayAdapter.name);
  private readonly taskQueue: string;

  constructor(
    @Inject(WORKFLOW_CLIENT) private readonly client: WorkflowClient,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    config: ConfigService,
  ) {
    this.taskQueue = config.getOrThrow<string>('TEMPORAL_TASK_QUEUE');
  }

  async startCharge(input: ChargeWorkflowInput): Promise<void> {
    // Captured HERE, in the ChargePayment consumer's active span, because the
    // workflow runs on a detached Temporal worker with no trace context — passing
    // it as workflow input lets the reply activity re-activate the originating
    // trace so the emitted reply stays under the saga's one trace id.
    const traceParent = input.traceParent ?? captureActiveTraceContext().traceparent;
    try {
      await this.client.start(CHARGE_WORKFLOW_TYPE, {
        workflowId: chargeWorkflowId(input.orderId),
        // Reject a duplicate start whether the prior run is OPEN or CLOSED, so a
        // command redelivered after the workflow completes can never spawn a new
        // run that charges again — the id owns the charge for its whole retention.
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
        taskQueue: this.taskQueue,
        args: [{ ...input, traceParent }],
      });
      this.logger.log(`Started charge workflow for order ${input.orderId}`);
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        await this.recoverReplyForDuplicateStart(input);
        return;
      }
      throw error;
    }
  }

  /**
   * A redelivered `ChargePayment` always hits this once `startCharge` sees
   * `WorkflowExecutionAlreadyStartedError` — never a second charge run
   * (`REJECT_DUPLICATE` owns that guarantee). What it recovers is the REPLY:
   * if the run already reached COMPLETED, its one-shot `emitReply` activity
   * already fired — but if that reply never reached the order side (dropped,
   * dead-lettered, or the saga was stuck before it ever ran), the saga can
   * never advance because the workflow will never emit a second time. Re-append
   * the run's already-decided `ProviderResult` here, under a brand-new outbox
   * event id, so the order's dedupe-by-event-id reply consumer treats it as a
   * fresh delivery. Deliberately skips the `IdempotentConsumer` dedupe guard the
   * emit-reply activity uses (that guard is what would otherwise suppress this
   * exact re-append) — dedup happens on the READ side (the order saga's
   * state-guarded transition), not here. A still-RUNNING workflow is left
   * alone — it will emit its own reply when it finishes, and re-emitting now
   * would race that reply.
   */
  private async recoverReplyForDuplicateStart(input: ChargeWorkflowInput): Promise<void> {
    const handle = this.client.getHandle<() => Promise<ProviderResult>>(
      chargeWorkflowId(input.orderId),
    );
    let statusName: string;
    try {
      statusName = (await handle.describe()).status.name;
    } catch (describeError) {
      // Can't determine the run's fate (purged past retention, transient
      // Temporal outage, etc). Stay a no-op like the prior behavior — the
      // reconciler will simply re-drive again on its next sweep.
      this.logger.warn(
        `Charge workflow already running for order ${input.orderId} — describe failed, no-op: ` +
          `${describeError instanceof Error ? describeError.message : String(describeError)}`,
      );
      return;
    }

    if (statusName !== 'COMPLETED') {
      // Still RUNNING (or any other non-terminal/unexpected status) — it owns
      // emitting its own reply; re-emitting now would race it.
      this.logger.log(`Charge workflow already running for order ${input.orderId} — no-op`);
      return;
    }

    try {
      const result = await handle.result();
      const reply = result.ok
        ? paymentSucceededReply(input.orderId, input.correlationId)
        : paymentFailedReply(
            input.orderId,
            result.reason ?? 'payment declined',
            input.correlationId,
          );
      await this.tenantContext.run({ tenantId: input.tenantId, actor: 'system', roles: [] }, () =>
        this.transaction.runInTransaction(() => this.outbox.append(reply)),
      );
      this.logger.log(
        `Re-appended reply for completed charge workflow, order ${input.orderId} (ok=${result.ok})`,
      );
    } catch (error) {
      // Never let a redelivered command path throw beyond its pre-existing
      // no-op behavior — the reconciler's next sweep gets another shot.
      this.logger.error(
        `Failed to recover reply for completed charge workflow, order ${input.orderId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async signalProviderResult(orderId: string, result: ProviderResult): Promise<void> {
    const handle = this.client.getHandle(chargeWorkflowId(orderId));
    try {
      await handle.signal(PROVIDER_RESULT_SIGNAL, result);
      this.logger.log(`Signalled provider result for order ${orderId} (ok=${result.ok})`);
    } catch (error) {
      // A webhook that lands after the workflow already completed has nothing to
      // reconcile — the reply was emitted from the synchronous decision. Swallow
      // the "no such open workflow" so a late callback is an accepted no-op, not
      // a 500 the provider keeps retrying.
      if (error instanceof WorkflowNotFoundError) {
        this.logger.log(`Charge workflow for order ${orderId} already closed — signal ignored`);
        return;
      }
      throw error;
    }
  }
}
