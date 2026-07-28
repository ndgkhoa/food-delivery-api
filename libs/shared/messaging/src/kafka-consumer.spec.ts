import { AlsTenantContextAdapter } from '@food-delivery-api/shared-tenancy';
import { Logger } from '@nestjs/common';
import type { RawInboundMessage } from './dead-letter';
import { encodeHeaders } from './event-envelope';
import type { DecodedKafkaMessage } from './kafka-consumer';
import { consumeOneMessage, runHandlerWithRetry } from './kafka-consumer';
import { type DropReason, MessageDropCounter } from './message-drop-counter';

function makeMessage(overrides: Partial<DecodedKafkaMessage> = {}): DecodedKafkaMessage {
  return {
    envelope: {
      eventId: 'evt-1',
      eventType: 'order.placed',
      aggregateId: 'order-1',
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      occurredAt: '2026-07-28T00:00:00.000Z',
    },
    payload: { id: 'order-1' },
    topic: 'order.events',
    partition: 0,
    offset: '5',
    ...overrides,
  };
}

function silentLogger(): Pick<Logger, 'warn' | 'error'> {
  return { warn: jest.fn(), error: jest.fn() };
}

describe('runHandlerWithRetry', () => {
  it('runs the handler once inside the tenant scope carried by the envelope on success', async () => {
    const tenantContext = new AlsTenantContextAdapter();
    const message = makeMessage();
    let seenTenantId: string | undefined;
    const handler = jest.fn(async () => {
      seenTenantId = tenantContext.getContext()?.tenantId;
    });

    const outcome = await runHandlerWithRetry(handler, message, tenantContext, {
      maxAttempts: 3,
      retryDelayMs: 0,
      logger: silentLogger(),
    });

    expect(outcome).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(message);
    expect(seenTenantId).toBe('tenant-1');
  });

  it('retries a failing handler up to maxAttempts and succeeds once it recovers', async () => {
    const tenantContext = new AlsTenantContextAdapter();
    const message = makeMessage();
    let attempts = 0;
    const handler = jest.fn(async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error('transient');
      }
    });

    const outcome = await runHandlerWithRetry(handler, message, tenantContext, {
      maxAttempts: 3,
      retryDelayMs: 0,
      logger: silentLogger(),
    });

    expect(outcome).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('reports not-ok after maxAttempts (never throws) so the caller can dead-letter', async () => {
    const tenantContext = new AlsTenantContextAdapter();
    const message = makeMessage();
    const handler = jest.fn().mockRejectedValue(new Error('always fails'));
    const logger = silentLogger();

    const outcome = await runHandlerWithRetry(handler, message, tenantContext, {
      maxAttempts: 2,
      retryDelayMs: 0,
      logger,
    });

    expect(outcome).toEqual({ ok: false, reason: 'always fails' });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('evt-1'));
  });
});

interface DlqCall {
  raw: RawInboundMessage;
  reason: DropReason;
  failureReason: string;
}

function makeConsumeDeps(handler: jest.Mock, dlqOk = true) {
  const dropCounter = new MessageDropCounter();
  const dlqCalls: DlqCall[] = [];
  const commit = jest.fn(async () => {});
  const deps = {
    handler,
    tenantContext: new AlsTenantContextAdapter(),
    dropCounter,
    deadLetter: jest.fn(
      async (raw: RawInboundMessage, reason: DropReason, failureReason: string) => {
        dlqCalls.push({ raw, reason, failureReason });
        return dlqOk;
      },
    ),
    commit,
    maxAttempts: 2,
    retryDelayMs: 0,
    logger: silentLogger(),
  };
  return { deps, dropCounter, dlqCalls, commit };
}

function rawMessage(headers: Record<string, string> | undefined): RawInboundMessage {
  return {
    topic: 'inventory.replies',
    partition: 1,
    message: {
      offset: '7',
      key: Buffer.from('order-1', 'utf8'),
      value: Buffer.from(JSON.stringify({ orderId: 'order-1' }), 'utf8'),
      headers,
    },
  };
}

describe('consumeOneMessage dead-letter paths', () => {
  it('dead-letters + counts an undecodable message (missing envelope headers), then commits past', async () => {
    const handler = jest.fn(async () => {});
    const { deps, dropCounter, dlqCalls, commit } = makeConsumeDeps(handler);

    // No headers → decodeHeaders fails closed → structurally unrecoverable.
    await consumeOneMessage(rawMessage(undefined), deps);

    expect(handler).not.toHaveBeenCalled();
    expect(dropCounter.get('inventory.replies', 'undecodable')).toBe(1);
    expect(dlqCalls).toHaveLength(1);
    expect(dlqCalls[0].reason).toBe('undecodable');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('dead-letters + counts a handler that exhausts its retries, and still advances the offset', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('db lock timeout'));
    const { deps, dropCounter, dlqCalls, commit } = makeConsumeDeps(handler);

    await consumeOneMessage(
      rawMessage(
        encodeHeaders({
          eventId: 'evt-1',
          eventType: 'StockReserved',
          aggregateId: 'order-1',
          tenantId: 'tenant-1',
          correlationId: 'corr-1',
          occurredAt: '2026-07-28T00:00:00.000Z',
        }),
      ),
      deps,
    );

    expect(handler).toHaveBeenCalledTimes(2);
    expect(dropCounter.get('inventory.replies', 'handler-exhausted')).toBe(1);
    expect(dlqCalls).toHaveLength(1);
    expect(dlqCalls[0].reason).toBe('handler-exhausted');
    expect(dlqCalls[0].failureReason).toBe('db lock timeout');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commits without dead-lettering when the handler succeeds', async () => {
    const handler = jest.fn(async () => {});
    const { deps, dropCounter, dlqCalls, commit } = makeConsumeDeps(handler);

    await consumeOneMessage(
      rawMessage(
        encodeHeaders({
          eventId: 'evt-2',
          eventType: 'StockReserved',
          aggregateId: 'order-1',
          tenantId: 'tenant-1',
          correlationId: 'corr-1',
          occurredAt: '2026-07-28T00:00:00.000Z',
        }),
      ),
      deps,
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(dropCounter.total()).toBe(0);
    expect(dlqCalls).toHaveLength(0);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does NOT commit or count when the dead-letter write itself fails (message redelivers, not lost)', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('db lock timeout'));
    // deadLetter resolves false → the DLQ write could not be made durable.
    const { deps, dropCounter, dlqCalls, commit } = makeConsumeDeps(handler, false);

    await consumeOneMessage(
      rawMessage(
        encodeHeaders({
          eventId: 'evt-3',
          eventType: 'StockReserved',
          aggregateId: 'order-1',
          tenantId: 'tenant-1',
          correlationId: 'corr-1',
          occurredAt: '2026-07-28T00:00:00.000Z',
        }),
      ),
      deps,
    );

    // DLQ was attempted, but since it failed the offset stays put (redelivery)
    // and the drop is not counted — no silent loss.
    expect(dlqCalls).toHaveLength(1);
    expect(dropCounter.total()).toBe(0);
    expect(commit).not.toHaveBeenCalled();
  });
});
