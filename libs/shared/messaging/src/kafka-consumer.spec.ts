import { AlsTenantContextAdapter } from '@food-delivery-api/shared-tenancy';
import { Logger } from '@nestjs/common';
import type { DecodedKafkaMessage } from './kafka-consumer';
import { runHandlerWithRetry } from './kafka-consumer';

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

    await runHandlerWithRetry(handler, message, tenantContext, {
      maxAttempts: 3,
      retryDelayMs: 0,
      logger: silentLogger(),
    });

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

    await runHandlerWithRetry(handler, message, tenantContext, {
      maxAttempts: 3,
      retryDelayMs: 0,
      logger: silentLogger(),
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts, logs, and does not throw (poison-message skip)', async () => {
    const tenantContext = new AlsTenantContextAdapter();
    const message = makeMessage();
    const handler = jest.fn().mockRejectedValue(new Error('always fails'));
    const logger = silentLogger();

    await expect(
      runHandlerWithRetry(handler, message, tenantContext, {
        maxAttempts: 2,
        retryDelayMs: 0,
        logger,
      }),
    ).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('evt-1'));
  });
});
