import {
  DuplicateEventError,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import type { TenantContextPort, TenantRequestContext } from '@food-delivery-api/shared-tenancy';
import type { OutboxCommandEntry, OutboxWriter } from '@payment/domain/shared/outbox.port';
import type { TransactionPort } from '@payment/domain/shared/transaction.port';
import { createEmitReplyActivity } from './emit-reply.activity';

jest.mock('@temporalio/activity', () => ({ log: { info: jest.fn() } }));

class FakeOutbox implements OutboxWriter {
  readonly entries: OutboxCommandEntry[] = [];
  async append(entry: OutboxCommandEntry): Promise<void> {
    this.entries.push(entry);
  }
}

/** Passes work straight through — the real adapter's ALS boundary isn't needed for logic tests. */
const passthroughTransaction: TransactionPort = { runInTransaction: (work) => work() };

/** Records the scope emit-reply establishes and runs the callback within it. */
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

/** Dedupe store that records the first event id and rejects a repeat. */
class FakeProcessedEvents implements ProcessedEventStorePort {
  readonly seen = new Set<string>();
  async markProcessed(_tx: unknown, eventId: string): Promise<void> {
    if (this.seen.has(eventId)) {
      throw new DuplicateEventError(eventId);
    }
    this.seen.add(eventId);
  }
}

function build() {
  const outbox = new FakeOutbox();
  const tenantContext = new FakeTenantContext();
  const processedEvents = new FakeProcessedEvents();
  const emitReply = createEmitReplyActivity({
    outbox,
    transaction: passthroughTransaction,
    processedEvents,
    tenantContext,
  });
  return { outbox, tenantContext, processedEvents, emitReply };
}

describe('createEmitReplyActivity', () => {
  it('appends a PaymentSucceeded reply under the command tenant scope', async () => {
    const { outbox, tenantContext, emitReply } = build();
    await emitReply({ orderId: 'o1', ok: true, correlationId: 'corr-1', tenantId: 'tenant-a' });

    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]).toMatchObject({
      aggregateId: 'o1',
      eventType: 'PaymentSucceeded',
      correlationId: 'corr-1',
    });
    expect(tenantContext.lastContext).toEqual({ tenantId: 'tenant-a', actor: 'system', roles: [] });
  });

  it('appends a PaymentFailed reply carrying the decline reason', async () => {
    const { outbox, emitReply } = build();
    await emitReply({
      orderId: 'o2',
      ok: false,
      reason: 'declined',
      correlationId: 'c',
      tenantId: 't',
    });

    expect(outbox.entries[0]).toMatchObject({ eventType: 'PaymentFailed' });
    expect(outbox.entries[0].payload).toMatchObject({ reason: 'declined' });
  });

  it('is idempotent by order id — a retried activity emits exactly one reply', async () => {
    const { outbox, emitReply } = build();
    const input = { orderId: 'o3', ok: true, correlationId: 'c', tenantId: 't' } as const;
    await emitReply(input);
    await emitReply(input);
    expect(outbox.entries).toHaveLength(1);
  });
});
