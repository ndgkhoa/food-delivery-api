/**
 * Unit-of-work boundary: runs `work` so that every persistence side effect it
 * performs (aggregate write + audit record) commits together or not at all.
 * The domain declares the contract; an infrastructure adapter binds it to the
 * real database transaction. Handlers depend on this port, never on TypeORM,
 * so the atomicity guarantee stays expressible without leaking the ORM inward.
 */
export interface TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}

export const TRANSACTION_PORT = Symbol('TransactionPort');
