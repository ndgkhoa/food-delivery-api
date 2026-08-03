/**
 * Unit-of-work boundary: runs `work` so the `processed_events` dedupe marker
 * and the notification row batch it guards commit together or not at all.
 */
export interface TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}

export const TRANSACTION_PORT = Symbol('TransactionPort');
