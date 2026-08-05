import { captureActiveTraceContext } from '@food-delivery-api/shared-observability';
import type { TenantContextPort, TenantRequestContext } from '@food-delivery-api/shared-tenancy';
import type { OutboxCommandEntry, OutboxWriter } from '@payment/domain/shared/outbox.port';
import type { TransactionPort } from '@payment/domain/shared/transaction.port';
import type { ChargeWorkflowInput } from '@payment/workflows/charge-workflow.types';
import {
  WorkflowClient,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';
import { TemporalWorkflowGatewayAdapter } from './temporal-workflow-gateway.adapter';

jest.mock('@food-delivery-api/shared-observability', () => ({
  captureActiveTraceContext: jest.fn(),
}));

const mockCaptureActiveTraceContext = captureActiveTraceContext as jest.MockedFunction<
  typeof captureActiveTraceContext
>;

class FakeOutbox implements OutboxWriter {
  readonly entries: OutboxCommandEntry[] = [];
  async append(entry: OutboxCommandEntry): Promise<void> {
    this.entries.push(entry);
  }
}

const passthroughTransaction: TransactionPort = { runInTransaction: (work) => work() };

class FakeTenantContext implements TenantContextPort {
  lastContext?: TenantRequestContext;
  run<T>(context: TenantRequestContext, callback: () => T): T {
    this.lastContext = context;
    return callback();
  }
  getContext(): TenantRequestContext | undefined {
    return this.lastContext;
  }
  getTenantIdOrThrow(): string {
    return this.lastContext?.tenantId ?? '';
  }
  getActor(): string {
    return this.lastContext?.actor ?? 'system';
  }
}

const config = { getOrThrow: () => 'payment-charges' } as never;

function buildInput(overrides: Partial<ChargeWorkflowInput> = {}): ChargeWorkflowInput {
  return {
    orderId: 'order-1',
    totalCents: 1500,
    correlationId: 'corr-1',
    tenantId: 'tenant-a',
    ...overrides,
  };
}

describe('TemporalWorkflowGatewayAdapter', () => {
  beforeEach(() => {
    mockCaptureActiveTraceContext.mockReturnValue({});
  });

  describe('startCharge', () => {
    it('starts the charge workflow on a fresh start and never touches the outbox', async () => {
      const start = jest.fn().mockResolvedValue(undefined);
      const client = { start } as unknown as WorkflowClient;
      const outbox = new FakeOutbox();
      const adapter = new TemporalWorkflowGatewayAdapter(
        client,
        outbox,
        passthroughTransaction,
        new FakeTenantContext(),
        config,
      );

      await adapter.startCharge(buildInput());

      expect(start).toHaveBeenCalledTimes(1);
      expect(outbox.entries).toHaveLength(0);
    });

    it('re-appends a PaymentSucceeded reply under a fresh event id when the completed run succeeded', async () => {
      const start = jest
        .fn()
        .mockRejectedValue(
          new WorkflowExecutionAlreadyStartedError(
            'already started',
            'charge-order-1',
            'chargeWorkflow',
          ),
        );
      const describe = jest.fn().mockResolvedValue({ status: { name: 'COMPLETED', code: 2 } });
      const result = jest.fn().mockResolvedValue({ ok: true });
      const getHandle = jest.fn().mockReturnValue({ describe, result });
      const client = { start, getHandle } as unknown as WorkflowClient;
      const outbox = new FakeOutbox();
      const tenantContext = new FakeTenantContext();
      const adapter = new TemporalWorkflowGatewayAdapter(
        client,
        outbox,
        passthroughTransaction,
        tenantContext,
        config,
      );

      await adapter.startCharge(buildInput());

      expect(start).toHaveBeenCalledTimes(1);
      expect(outbox.entries).toHaveLength(1);
      expect(outbox.entries[0]).toMatchObject({
        aggregateId: 'order-1',
        eventType: 'PaymentSucceeded',
        correlationId: 'corr-1',
      });
      expect(tenantContext.lastContext).toEqual({
        tenantId: 'tenant-a',
        actor: 'system',
        roles: [],
      });
    });

    it('re-appends a PaymentFailed reply carrying the decline reason when the completed run failed', async () => {
      const start = jest
        .fn()
        .mockRejectedValue(
          new WorkflowExecutionAlreadyStartedError(
            'already started',
            'charge-order-2',
            'chargeWorkflow',
          ),
        );
      const describe = jest.fn().mockResolvedValue({ status: { name: 'COMPLETED', code: 2 } });
      const result = jest.fn().mockResolvedValue({ ok: false, reason: 'card declined' });
      const getHandle = jest.fn().mockReturnValue({ describe, result });
      const client = { start, getHandle } as unknown as WorkflowClient;
      const outbox = new FakeOutbox();
      const adapter = new TemporalWorkflowGatewayAdapter(
        client,
        outbox,
        passthroughTransaction,
        new FakeTenantContext(),
        config,
      );

      await adapter.startCharge(buildInput({ orderId: 'order-2' }));

      expect(start).toHaveBeenCalledTimes(1);
      expect(outbox.entries[0]).toMatchObject({ eventType: 'PaymentFailed' });
      expect(outbox.entries[0].payload).toMatchObject({ reason: 'card declined' });
    });

    it('does not append a reply while the run is still RUNNING — it will emit its own', async () => {
      const start = jest
        .fn()
        .mockRejectedValue(
          new WorkflowExecutionAlreadyStartedError(
            'already started',
            'charge-order-3',
            'chargeWorkflow',
          ),
        );
      const describe = jest.fn().mockResolvedValue({ status: { name: 'RUNNING', code: 1 } });
      const result = jest.fn();
      const getHandle = jest.fn().mockReturnValue({ describe, result });
      const client = { start, getHandle } as unknown as WorkflowClient;
      const outbox = new FakeOutbox();
      const adapter = new TemporalWorkflowGatewayAdapter(
        client,
        outbox,
        passthroughTransaction,
        new FakeTenantContext(),
        config,
      );

      await adapter.startCharge(buildInput({ orderId: 'order-3' }));

      expect(result).not.toHaveBeenCalled();
      expect(outbox.entries).toHaveLength(0);
      expect(start).toHaveBeenCalledTimes(1);
    });

    it('stays a no-op and never throws when describe() itself fails', async () => {
      const start = jest
        .fn()
        .mockRejectedValue(
          new WorkflowExecutionAlreadyStartedError(
            'already started',
            'charge-order-4',
            'chargeWorkflow',
          ),
        );
      const describe = jest.fn().mockRejectedValue(new Error('workflow purged past retention'));
      const getHandle = jest.fn().mockReturnValue({ describe, result: jest.fn() });
      const client = { start, getHandle } as unknown as WorkflowClient;
      const outbox = new FakeOutbox();
      const adapter = new TemporalWorkflowGatewayAdapter(
        client,
        outbox,
        passthroughTransaction,
        new FakeTenantContext(),
        config,
      );

      await expect(
        adapter.startCharge(buildInput({ orderId: 'order-4' })),
      ).resolves.toBeUndefined();
      expect(outbox.entries).toHaveLength(0);
    });

    it('propagates a start failure that is not a duplicate-start error', async () => {
      const start = jest.fn().mockRejectedValue(new Error('temporal unavailable'));
      const client = { start } as unknown as WorkflowClient;
      const adapter = new TemporalWorkflowGatewayAdapter(
        client,
        new FakeOutbox(),
        passthroughTransaction,
        new FakeTenantContext(),
        config,
      );

      await expect(adapter.startCharge(buildInput())).rejects.toThrow('temporal unavailable');
    });
  });

  describe('signalProviderResult', () => {
    it('signals the running workflow', async () => {
      const signal = jest.fn().mockResolvedValue(undefined);
      const getHandle = jest.fn().mockReturnValue({ signal });
      const client = { getHandle } as unknown as WorkflowClient;
      const adapter = new TemporalWorkflowGatewayAdapter(
        client,
        new FakeOutbox(),
        passthroughTransaction,
        new FakeTenantContext(),
        config,
      );

      await adapter.signalProviderResult('order-5', { ok: true });

      expect(signal).toHaveBeenCalledTimes(1);
    });

    it('swallows a signal against an already-closed workflow', async () => {
      const signal = jest
        .fn()
        .mockRejectedValue(new WorkflowNotFoundError('not found', 'charge-order-6', undefined));
      const getHandle = jest.fn().mockReturnValue({ signal });
      const client = { getHandle } as unknown as WorkflowClient;
      const adapter = new TemporalWorkflowGatewayAdapter(
        client,
        new FakeOutbox(),
        passthroughTransaction,
        new FakeTenantContext(),
        config,
      );

      await expect(adapter.signalProviderResult('order-6', { ok: true })).resolves.toBeUndefined();
    });
  });
});
