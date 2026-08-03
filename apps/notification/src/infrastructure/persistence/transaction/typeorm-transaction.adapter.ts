import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { TransactionPort } from '@notification/domain/shared/transaction.port';
import { runWithEntityManager } from '@notification/infrastructure/persistence/transaction/transactional-entity-manager';
import type { DataSource } from 'typeorm';

/**
 * Binds the domain `TransactionPort` to a real Postgres transaction. Publishes
 * the transaction's `EntityManager` on async-local storage so the dedupe write
 * and the notification row batch share one commit boundary.
 */
@Injectable()
export class TypeOrmTransactionAdapter implements TransactionPort {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => runWithEntityManager(manager, work));
  }
}
