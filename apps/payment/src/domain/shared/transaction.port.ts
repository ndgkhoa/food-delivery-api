/**
 * Unit-of-work boundary: runs `work` so the dedupe marker and the reply-outbox
 * append commit together or not at all. The stub owns no domain tables yet, so
 * this is the only place a transaction is needed today.
 */
export interface TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}

export const TRANSACTION_PORT = Symbol('TransactionPort');
