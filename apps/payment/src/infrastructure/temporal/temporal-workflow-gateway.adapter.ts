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
import { WorkflowClient, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

/** Deterministic per-order workflow id → Temporal dedupes concurrent/redelivered starts. */
function chargeWorkflowId(orderId: string): string {
  return `charge-${orderId}`;
}

/**
 * Temporal-backed `WorkflowGatewayPort`. Starts the charge workflow keyed by
 * order id; a redelivered `ChargePayment` that targets an already-running (or
 * closed, within retention) id raises `WorkflowExecutionAlreadyStartedError`,
 * which is treated as an idempotent no-op — the workflow already owns the charge.
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
    await handle.signal(PROVIDER_RESULT_SIGNAL, result);
    this.logger.log(`Signalled provider result for order ${orderId} (ok=${result.ok})`);
  }
}
