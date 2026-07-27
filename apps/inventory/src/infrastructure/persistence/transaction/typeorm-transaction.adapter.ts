import type { TransactionPort } from '@inventory/domain/shared/transaction.port';
import { runWithEntityManager } from '@inventory/infrastructure/persistence/transaction/transactional-entity-manager';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

/**
 * Binds the domain `TransactionPort` to a real Postgres transaction. Opens one
 * transaction, publishes its `EntityManager` on async-local storage, and runs
 * the reserve/release work inside it — so the stock decrement and reservation
 * insert share one commit boundary and roll back together on any failure.
 */
@Injectable()
export class TypeOrmTransactionAdapter implements TransactionPort {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => runWithEntityManager(manager, work));
  }
}
