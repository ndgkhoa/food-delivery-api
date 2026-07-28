import {
  DuplicateEventError,
  IdempotentConsumer,
  type ProcessedEventStorePort,
} from './idempotent-consumer';

/** In-memory fake standing in for a service's dedupe-table adapter. */
class FakeProcessedEventStore implements ProcessedEventStorePort<string> {
  private readonly seen = new Set<string>();
  markProcessedCalls: Array<{ tx: string; eventId: string }> = [];

  async markProcessed(tx: string, eventId: string): Promise<void> {
    this.markProcessedCalls.push({ tx, eventId });
    if (this.seen.has(eventId)) {
      throw new DuplicateEventError(eventId);
    }
    this.seen.add(eventId);
  }
}

describe('IdempotentConsumer.runOnce', () => {
  it('records the event and runs the work on first delivery', async () => {
    const store = new FakeProcessedEventStore();
    const work = jest.fn().mockResolvedValue('applied');

    const result = await IdempotentConsumer.runOnce(store, 'evt-1', 'tx-a', work);

    expect(result).toBe('applied');
    expect(work).toHaveBeenCalledTimes(1);
    expect(store.markProcessedCalls).toEqual([{ tx: 'tx-a', eventId: 'evt-1' }]);
  });

  it('skips the work and returns undefined on a redelivered (duplicate) event id', async () => {
    const store = new FakeProcessedEventStore();
    const work = jest.fn().mockResolvedValue('applied');
    await IdempotentConsumer.runOnce(store, 'evt-1', 'tx-a', work);

    const result = await IdempotentConsumer.runOnce(store, 'evt-1', 'tx-b', work);

    expect(result).toBeUndefined();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('propagates a non-duplicate error from the store without running the work', async () => {
    const store: ProcessedEventStorePort<string> = {
      markProcessed: jest.fn().mockRejectedValue(new Error('connection reset')),
    };
    const work = jest.fn();

    await expect(IdempotentConsumer.runOnce(store, 'evt-1', 'tx-a', work)).rejects.toThrow(
      'connection reset',
    );
    expect(work).not.toHaveBeenCalled();
  });

  it('propagates an error thrown by the work itself', async () => {
    const store = new FakeProcessedEventStore();
    const work = jest.fn().mockRejectedValue(new Error('side effect failed'));

    await expect(IdempotentConsumer.runOnce(store, 'evt-1', 'tx-a', work)).rejects.toThrow(
      'side effect failed',
    );
  });
});
