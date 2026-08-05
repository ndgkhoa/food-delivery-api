import { Logger } from '@nestjs/common';
import type { MessageProducer, OutboundKafkaMessage } from './kafka-producer';
import { type OutboxPort, type OutboxRecord, OutboxRelay } from './outbox-relay';

class FakeOutboxPort implements OutboxPort {
  rows: OutboxRecord[] = [];
  markPublishedCalls: string[][] = [];
  incrementAttemptsCalls: string[][] = [];
  runExclusively?: OutboxPort['runExclusively'];

  async fetchUnpublished(limit: number): Promise<OutboxRecord[]> {
    return this.rows.slice(0, limit);
  }

  async markPublished(ids: string[]): Promise<void> {
    this.markPublishedCalls.push(ids);
    this.rows = this.rows.filter((row) => !ids.includes(row.id));
  }

  async incrementAttempts(ids: string[]): Promise<void> {
    this.incrementAttemptsCalls.push(ids);
  }
}

class FakeProducer implements MessageProducer {
  published: OutboundKafkaMessage[] = [];
  publishBatchCalls: OutboundKafkaMessage[][] = [];
  failNextBatch = false;

  async publish(message: OutboundKafkaMessage): Promise<void> {
    this.published.push(message);
  }

  async publishBatch(messages: OutboundKafkaMessage[]): Promise<void> {
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error('broker unavailable');
    }
    this.publishBatchCalls.push(messages);
    this.published.push(...messages);
  }
}

class NoIncrementAttemptsOutboxPort implements OutboxPort {
  rows: OutboxRecord[] = [];
  markPublishedCalls: string[][] = [];

  async fetchUnpublished(limit: number): Promise<OutboxRecord[]> {
    return this.rows.slice(0, limit);
  }

  async markPublished(ids: string[]): Promise<void> {
    this.markPublishedCalls.push(ids);
  }
}

function buildRow(id: string): OutboxRecord {
  return {
    id,
    topic: 'order.events',
    key: `order-${id}`,
    headers: { 'x-event-id': id },
    value: { id },
  };
}

describe('OutboxRelay.runOnce', () => {
  it('publishes a fetched batch and marks it published', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [buildRow('1'), buildRow('2')];
    const producer = new FakeProducer();
    const relay = new OutboxRelay(outbox, producer);

    const count = await relay.runOnce();

    expect(count).toBe(2);
    expect(producer.publishBatchCalls).toHaveLength(1);
    expect(producer.publishBatchCalls[0]).toHaveLength(2);
    expect(outbox.markPublishedCalls).toEqual([['1', '2']]);
  });

  it('returns 0 and publishes nothing when there is nothing unpublished', async () => {
    const outbox = new FakeOutboxPort();
    const producer = new FakeProducer();
    const relay = new OutboxRelay(outbox, producer);

    const count = await relay.runOnce();

    expect(count).toBe(0);
    expect(producer.publishBatchCalls).toHaveLength(0);
  });

  it('does not mark rows published when the publish batch fails', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [buildRow('1')];
    const producer = new FakeProducer();
    producer.failNextBatch = true;
    const relay = new OutboxRelay(outbox, producer);

    await expect(relay.runOnce()).rejects.toThrow('broker unavailable');
    expect(outbox.markPublishedCalls).toHaveLength(0);
  });

  it('increments the attempts counter for the rows it tried when the publish fails', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [buildRow('1'), buildRow('2')];
    const producer = new FakeProducer();
    producer.failNextBatch = true;
    const relay = new OutboxRelay(outbox, producer);

    await expect(relay.runOnce()).rejects.toThrow('broker unavailable');
    expect(outbox.incrementAttemptsCalls).toEqual([['1', '2']]);
    expect(outbox.markPublishedCalls).toHaveLength(0);
  });

  it('silently skips attempt tracking when the outbox port has no incrementAttempts', async () => {
    const outbox = new NoIncrementAttemptsOutboxPort();
    outbox.rows = [buildRow('1')];
    const producer = new FakeProducer();
    producer.failNextBatch = true;
    const relay = new OutboxRelay(outbox, producer);

    await expect(relay.runOnce()).rejects.toThrow('broker unavailable');
    expect(outbox.markPublishedCalls).toHaveLength(0);
  });

  it('logs a warning without throwing when incrementAttempts itself fails', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [buildRow('1')];
    jest.spyOn(outbox, 'incrementAttempts').mockRejectedValue(new Error('db unreachable'));
    const producer = new FakeProducer();
    producer.failNextBatch = true;
    const relay = new OutboxRelay(outbox, producer);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(relay.runOnce()).rejects.toThrow('broker unavailable');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to record outbox publish attempts: db unreachable'),
    );
    errorSpy.mockRestore();
  });

  it('respects the configured batch size', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [buildRow('1'), buildRow('2'), buildRow('3')];
    const producer = new FakeProducer();
    const relay = new OutboxRelay(outbox, producer, { batchSize: 2 });

    const count = await relay.runOnce();

    expect(count).toBe(2);
  });
});

describe('OutboxRelay.runOnce with runExclusively', () => {
  it('wraps the drain in runExclusively and returns its result when the lock is won', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [buildRow('1'), buildRow('2')];
    const producer = new FakeProducer();
    const runExclusively = jest.fn(async (drain: () => Promise<number>) => {
      const result = await drain();
      return { ran: true, result };
    });
    outbox.runExclusively = runExclusively as unknown as OutboxPort['runExclusively'];
    const relay = new OutboxRelay(outbox, producer);

    const count = await relay.runOnce();

    expect(count).toBe(2);
    expect(runExclusively).toHaveBeenCalledTimes(1);
    expect(producer.publishBatchCalls).toHaveLength(1);
    expect(outbox.markPublishedCalls).toEqual([['1', '2']]);
  });

  it('returns 0 without publishing when the advisory lock is contended (ran: false)', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [buildRow('1')];
    const producer = new FakeProducer();
    outbox.runExclusively = jest.fn().mockResolvedValue({ ran: false });
    const relay = new OutboxRelay(outbox, producer);

    const count = await relay.runOnce();

    expect(count).toBe(0);
    expect(producer.publishBatchCalls).toHaveLength(0);
    expect(outbox.markPublishedCalls).toHaveLength(0);
  });

  it('propagates a publish failure raised inside the exclusively-run drain', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [buildRow('1')];
    const producer = new FakeProducer();
    producer.failNextBatch = true;
    outbox.runExclusively = (async (drain: () => Promise<number>) => ({
      ran: true,
      result: await drain(),
    })) as unknown as OutboxPort['runExclusively'];
    const relay = new OutboxRelay(outbox, producer);

    await expect(relay.runOnce()).rejects.toThrow('broker unavailable');
    expect(outbox.markPublishedCalls).toHaveLength(0);
  });
});

describe('OutboxRelay start/stop loop', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls repeatedly at the configured interval while running is true', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [buildRow('1')];
    const producer = new FakeProducer();
    const relay = new OutboxRelay(outbox, producer, { intervalMs: 1000 });

    relay.start();
    await jest.advanceTimersByTimeAsync(0);
    outbox.rows = [buildRow('2')];
    await jest.advanceTimersByTimeAsync(1000);

    expect(producer.published.map((m) => m.key)).toEqual(['order-1', 'order-2']);
    relay.stop();
  });

  it('ignores a second start() call while already running', async () => {
    const outbox = new FakeOutboxPort();
    const producer = new FakeProducer();
    const relay = new OutboxRelay(outbox, producer, { intervalMs: 1000 });

    relay.start();
    relay.start();
    await jest.advanceTimersByTimeAsync(0);
    outbox.rows = [buildRow('only-once')];
    await jest.advanceTimersByTimeAsync(1000);

    expect(producer.published.map((m) => m.key)).toEqual(['order-only-once']);
    relay.stop();
  });

  it('stops scheduling further ticks after stop()', async () => {
    const outbox = new FakeOutboxPort();
    const producer = new FakeProducer();
    const relay = new OutboxRelay(outbox, producer, { intervalMs: 1000 });

    relay.start();
    await jest.advanceTimersByTimeAsync(0);
    relay.stop();
    outbox.rows = [buildRow('never-published')];
    await jest.advanceTimersByTimeAsync(5000);

    expect(producer.published).toHaveLength(0);
  });

  it('backs off exponentially after a failed drain, then resets on success', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [buildRow('1')];
    const producer = new FakeProducer();
    producer.failNextBatch = true;
    const relay = new OutboxRelay(outbox, producer, { intervalMs: 1000, maxBackoffMs: 8000 });

    relay.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(producer.published).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(1000);
    expect(producer.published).toHaveLength(1);

    relay.stop();
  });
});
