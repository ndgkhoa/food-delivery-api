import type { MessageProducer, OutboundKafkaMessage } from './kafka-producer';
import { type OutboxPort, type OutboxRecord, OutboxRelay } from './outbox-relay';

class FakeOutboxPort implements OutboxPort {
  rows: OutboxRecord[] = [];
  markPublishedCalls: string[][] = [];
  incrementAttemptsCalls: string[][] = [];

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

function makeRow(id: string): OutboxRecord {
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
    outbox.rows = [makeRow('1'), makeRow('2')];
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
    outbox.rows = [makeRow('1')];
    const producer = new FakeProducer();
    producer.failNextBatch = true;
    const relay = new OutboxRelay(outbox, producer);

    await expect(relay.runOnce()).rejects.toThrow('broker unavailable');
    expect(outbox.markPublishedCalls).toHaveLength(0);
  });

  it('increments the attempts counter for the rows it tried when the publish fails', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [makeRow('1'), makeRow('2')];
    const producer = new FakeProducer();
    producer.failNextBatch = true;
    const relay = new OutboxRelay(outbox, producer);

    await expect(relay.runOnce()).rejects.toThrow('broker unavailable');
    expect(outbox.incrementAttemptsCalls).toEqual([['1', '2']]);
    expect(outbox.markPublishedCalls).toHaveLength(0);
  });

  it('respects the configured batch size', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [makeRow('1'), makeRow('2'), makeRow('3')];
    const producer = new FakeProducer();
    const relay = new OutboxRelay(outbox, producer, { batchSize: 2 });

    const count = await relay.runOnce();

    expect(count).toBe(2);
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
    outbox.rows = [makeRow('1')];
    const producer = new FakeProducer();
    const relay = new OutboxRelay(outbox, producer, { intervalMs: 1000 });

    relay.start();
    await jest.advanceTimersByTimeAsync(0); // first immediate tick
    outbox.rows = [makeRow('2')];
    await jest.advanceTimersByTimeAsync(1000); // second scheduled tick

    expect(producer.published.map((m) => m.key)).toEqual(['order-1', 'order-2']);
    relay.stop();
  });

  it('stops scheduling further ticks after stop()', async () => {
    const outbox = new FakeOutboxPort();
    const producer = new FakeProducer();
    const relay = new OutboxRelay(outbox, producer, { intervalMs: 1000 });

    relay.start();
    await jest.advanceTimersByTimeAsync(0);
    relay.stop();
    outbox.rows = [makeRow('never-published')];
    await jest.advanceTimersByTimeAsync(5000);

    expect(producer.published).toHaveLength(0);
  });

  it('backs off exponentially after a failed drain, then resets on success', async () => {
    const outbox = new FakeOutboxPort();
    outbox.rows = [makeRow('1')];
    const producer = new FakeProducer();
    producer.failNextBatch = true;
    const relay = new OutboxRelay(outbox, producer, { intervalMs: 1000, maxBackoffMs: 8000 });

    relay.start();
    await jest.advanceTimersByTimeAsync(0); // fails, schedules retry at +1000 (current backoff)
    expect(producer.published).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(1000); // succeeds this time
    expect(producer.published).toHaveLength(1);

    relay.stop();
  });
});
