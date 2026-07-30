/**
 * Unit-of-work boundary: runs `work` so the review insert, its outbox row,
 * and (for the eligibility consumer) the `processed_events` dedupe marker
 * commit together or not at all.
 */
export interface TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}

export const TRANSACTION_PORT = Symbol('TransactionPort');
