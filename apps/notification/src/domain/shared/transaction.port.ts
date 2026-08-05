export interface TransactionPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}

export const TRANSACTION_PORT = Symbol('TransactionPort');
