import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkflowGatewayPort } from '@payment/domain/shared/workflow-gateway.port';
import { WORKFLOW_CLIENT } from '@payment/infrastructure/temporal/temporal.tokens';
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
 * `WorkflowExecutionAlreadyStartedError` and is treated as an idempotent no-op —
 * exactly one charge per order, never a second run re-executing the charge activity.
 * Signals route an async provider result from the webhook to the waiting workflow.
 */
@Injectable()
export class TemporalWorkflowGatewayAdapter implements WorkflowGatewayPort {
  private readonly logger = new Logger(TemporalWorkflowGatewayAdapter.name);
  private readonly taskQueue: string;

  constructor(
    @Inject(WORKFLOW_CLIENT) private readonly client: WorkflowClient,
    config: ConfigService,
  ) {
    this.taskQueue = config.getOrThrow<string>('TEMPORAL_TASK_QUEUE');
  }

  async startCharge(input: ChargeWorkflowInput): Promise<void> {
    try {
      await this.client.start(CHARGE_WORKFLOW_TYPE, {
        workflowId: chargeWorkflowId(input.orderId),
        // Reject a duplicate start whether the prior run is OPEN or CLOSED, so a
        // command redelivered after the workflow completes can never spawn a new
        // run that charges again — the id owns the charge for its whole retention.
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
        taskQueue: this.taskQueue,
        args: [input],
      });
      this.logger.log(`Started charge workflow for order ${input.orderId}`);
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        this.logger.log(`Charge workflow already running for order ${input.orderId} — no-op`);
        return;
      }
      throw error;
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
