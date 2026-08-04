export class DuplicateEventError extends Error {
  constructor(readonly eventId: string) {
    super(`Event "${eventId}" was already processed`);
    this.name = 'DuplicateEventError';
  }
}

export interface ProcessedEventStorePort<TTx = unknown> {
  markProcessed(tx: TTx, eventId: string): Promise<void>;
}

export const PROCESSED_EVENT_STORE = Symbol('ProcessedEventStore');

export class IdempotentConsumer {
  static async runOnce<TTx, TResult>(
    store: ProcessedEventStorePort<TTx>,
    eventId: string,
    tx: TTx,
    work: (tx: TTx) => Promise<TResult>,
  ): Promise<TResult | undefined> {
    try {
      await store.markProcessed(tx, eventId);
    } catch (error) {
      if (error instanceof DuplicateEventError) {
        return undefined;
      }
      throw error;
    }
    return work(tx);
  }
}
