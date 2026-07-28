/**
 * Raised by a `ProcessedEventStorePort` adapter when it attempts to record an
 * event id that is already marked processed (e.g. a translated Postgres
 * unique-violation). Framework/db-free on purpose — the port owns translating
 * its storage's error shape into this signal.
 */
export class DuplicateEventError extends Error {
  constructor(readonly eventId: string) {
    super(`Event "${eventId}" was already processed`);
    this.name = 'DuplicateEventError';
  }
}

/**
 * Port a service's own dedupe-table adapter implements, inside the same
 * transaction as the handler's side effects — so "recorded as processed" and
 * "side effects applied" commit or roll back together.
 */
export interface ProcessedEventStorePort<TTx = unknown> {
  /** Inserts a dedupe row for `eventId` inside `tx`; throws `DuplicateEventError` if already recorded. */
  markProcessed(tx: TTx, eventId: string): Promise<void>;
}

export const PROCESSED_EVENT_STORE = Symbol('ProcessedEventStore');

/**
 * Dedupes a consumer handler's effect by event id inside the caller's
 * transaction: records the event id first, and only runs `work` if that
 * succeeded. A `DuplicateEventError` means this event was already handled —
 * skip `work` and return `undefined` rather than re-applying the effect.
 */
export class IdempotentConsumer {
  static async runOnce<TTx, TResult>(
    store: ProcessedEventStorePort<TTx>,
    eventId: string,
    tx: TTx,
    work: () => Promise<TResult>,
  ): Promise<TResult | undefined> {
    try {
      await store.markProcessed(tx, eventId);
    } catch (error) {
      if (error instanceof DuplicateEventError) {
        return undefined;
      }
      throw error;
    }
    return work();
  }
}
