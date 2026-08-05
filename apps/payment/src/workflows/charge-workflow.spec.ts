import { chargeWorkflow, providerResultSignal } from '@payment/workflows/charge-workflow';
import type {
  EmitReplyActivityInput,
  PaymentActivities,
} from '@payment/workflows/charge-workflow.types';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';

const gatedDescribe = process.env.RUN_TEMPORAL_TESTS === '1' ? describe : describe.skip;

const TASK_QUEUE = 'payment-charges-test';

function baseInput() {
  return { orderId: 'order-1', totalCents: 1000, correlationId: 'corr-1', tenantId: 'tenant-a' };
}

gatedDescribe('chargeWorkflow (durable orchestration)', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  async function runWith(
    activities: PaymentActivities,
    signalOk?: boolean,
  ): Promise<{ ok: boolean; reason?: string }> {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./charge-workflow'),
      activities,
    });
    return worker.runUntil(async () => {
      const handle = await env.client.workflow.start(chargeWorkflow, {
        workflowId: `charge-${baseInput().orderId}-${Math.random()}`,
        taskQueue: TASK_QUEUE,
        args: [baseInput()],
      });
      if (signalOk !== undefined) {
        await handle.signal(providerResultSignal, { ok: signalOk, reason: 'from-webhook' });
      }
      return handle.result();
    });
  }

  it('charges then emits a success reply', async () => {
    const emitted: EmitReplyActivityInput[] = [];
    const result = await runWith({
      charge: async () => ({ ok: true }),
      emitReply: async (input) => {
        emitted.push(input);
      },
    });
    expect(result.ok).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ orderId: 'order-1', ok: true });
  });

  it('emits a failed reply on a decline', async () => {
    const emitted: EmitReplyActivityInput[] = [];
    const result = await runWith({
      charge: async () => ({ ok: false, reason: 'declined' }),
      emitReply: async (input) => {
        emitted.push(input);
      },
    });
    expect(result.ok).toBe(false);
    expect(emitted[0]).toMatchObject({ ok: false, reason: 'declined' });
  });

  it('reconciles an async (pending) outcome from a webhook signal', async () => {
    const emitted: EmitReplyActivityInput[] = [];
    const result = await runWith(
      {
        charge: async () => ({ ok: true, pending: true }),
        emitReply: async (input) => {
          emitted.push(input);
        },
      },
      false,
    );
    expect(result.ok).toBe(false);
    expect(emitted[0]).toMatchObject({ ok: false, reason: 'from-webhook' });
  });

  it('does not wait for a webhook when the decision is synchronous', async () => {
    const emitted: EmitReplyActivityInput[] = [];
    const result = await runWith({
      charge: async () => ({ ok: true }),
      emitReply: async (input) => {
        emitted.push(input);
      },
    });
    expect(result.ok).toBe(true);
    expect(emitted).toHaveLength(1);
  });
});
