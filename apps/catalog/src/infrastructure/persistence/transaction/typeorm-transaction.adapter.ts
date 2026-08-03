import type { TransactionPort } from '@catalog/domain/shared/transaction.port';
import { runWithEntityManager } from '@catalog/infrastructure/persistence/transaction/transactional-entity-manager';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

/**
 * Binds the domain `TransactionPort` to a real Postgres transaction. Opens one
 * transaction, publishes its `EntityManager` on async-local storage, and runs
 * the use-case work inside it — so the aggregate write and the audit record
 * share one commit boundary and roll back together on any failure.
 */
@Injectable()
export class TypeOrmTransactionAdapter implements TransactionPort {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => runWithEntityManager(manager, work));
  }
}
