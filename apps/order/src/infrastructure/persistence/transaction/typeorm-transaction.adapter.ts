import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { TransactionPort } from '@order/domain/shared/transaction.port';
import { runWithEntityManager } from '@order/infrastructure/persistence/transaction/transactional-entity-manager';
import type { DataSource } from 'typeorm';

/**
 * Binds the domain `TransactionPort` to a real Postgres transaction. Opens
 * one transaction, publishes its `EntityManager` on async-local storage, and
 * runs the place-order persist inside it — so the order insert and its
 * cascaded order-item inserts share one commit boundary.
 */
@Injectable()
export class TypeOrmTransactionAdapter implements TransactionPort {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => runWithEntityManager(manager, work));
  }
}
