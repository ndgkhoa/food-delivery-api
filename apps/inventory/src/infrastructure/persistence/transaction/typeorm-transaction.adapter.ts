import type { TransactionPort } from '@inventory/domain/shared/transaction.port';
import { runWithEntityManager } from '@inventory/infrastructure/persistence/transaction/transactional-entity-manager';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

@Injectable()
export class TypeOrmTransactionAdapter implements TransactionPort {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => runWithEntityManager(manager, work));
  }
}
