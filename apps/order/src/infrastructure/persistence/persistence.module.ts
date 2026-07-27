import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IDEMPOTENCY_REPOSITORY } from '@order/domain/idempotency/idempotency.repository';
import { ORDER_REPOSITORY } from '@order/domain/order/order.repository';
import { TRANSACTION_PORT } from '@order/domain/shared/transaction.port';
import { IdempotencyKeyOrmEntity } from '@order/infrastructure/persistence/entities/idempotency-key.orm-entity';
import { OrderOrmEntity } from '@order/infrastructure/persistence/entities/order.orm-entity';
import { OrderItemOrmEntity } from '@order/infrastructure/persistence/entities/order-item.orm-entity';
import { TypeOrmIdempotencyRepository } from '@order/infrastructure/persistence/repositories/typeorm-idempotency.repository';
import { TypeOrmOrderRepository } from '@order/infrastructure/persistence/repositories/typeorm-order.repository';
import { TypeOrmTransactionAdapter } from '@order/infrastructure/persistence/transaction/typeorm-transaction.adapter';
import { buildDataSourceOptions } from '@order/infrastructure/persistence/typeorm-options';

/**
 * Owns the order Postgres connection + binds the domain repository ports to
 * their TypeORM adapters. Any module needing `ORDER_REPOSITORY` /
 * `IDEMPOTENCY_REPOSITORY` / `TRANSACTION_PORT` imports this module.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildDataSourceOptions({
          DB_HOST: config.getOrThrow<string>('DB_HOST'),
          DB_PORT: config.getOrThrow<number>('DB_PORT'),
          DB_USERNAME: config.getOrThrow<string>('DB_USERNAME'),
          DB_PASSWORD: config.getOrThrow<string>('DB_PASSWORD'),
          DB_NAME: config.getOrThrow<string>('DB_NAME'),
        }),
    }),
    TypeOrmModule.forFeature([OrderOrmEntity, OrderItemOrmEntity, IdempotencyKeyOrmEntity]),
  ],
  providers: [
    { provide: ORDER_REPOSITORY, useClass: TypeOrmOrderRepository },
    { provide: IDEMPOTENCY_REPOSITORY, useClass: TypeOrmIdempotencyRepository },
    { provide: TRANSACTION_PORT, useClass: TypeOrmTransactionAdapter },
  ],
  exports: [ORDER_REPOSITORY, IDEMPOTENCY_REPOSITORY, TRANSACTION_PORT],
})
export class PersistenceModule {}
