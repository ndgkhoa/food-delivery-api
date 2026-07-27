/**
 * Unit-of-work boundary: runs `work` so that every persistence side effect it
 * performs (order + order-item insert) commits together or not at all. The
 * domain declares the contract; an infrastructure adapter binds it to the
 * real database transaction, so the place-order use case expresses atomicity
 * without ever importing TypeORM.
 */
export interface TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}

export const TRANSACTION_PORT = Symbol('TransactionPort');
