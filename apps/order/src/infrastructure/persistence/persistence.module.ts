import { OUTBOX_PORT, PROCESSED_EVENT_STORE } from '@food-delivery-api/shared-messaging';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IDEMPOTENCY_REPOSITORY } from '@order/domain/idempotency/idempotency.repository';
import { ORDER_REPOSITORY } from '@order/domain/order/order.repository';
import { ORDER_SAGA_REPOSITORY } from '@order/domain/saga/order-saga.repository';
import { OUTBOX_WRITER } from '@order/domain/shared/outbox.port';
import { TRANSACTION_PORT } from '@order/domain/shared/transaction.port';
import { TypeOrmOrderOutboxAdapter } from '@order/infrastructure/outbox/typeorm-order-outbox.adapter';
import { TypeOrmProcessedEventStore } from '@order/infrastructure/outbox/typeorm-processed-event.store';
import { IdempotencyKeyOrmEntity } from '@order/infrastructure/persistence/entities/idempotency-key.orm-entity';
import { OrderOrmEntity } from '@order/infrastructure/persistence/entities/order.orm-entity';
import { OrderItemOrmEntity } from '@order/infrastructure/persistence/entities/order-item.orm-entity';
import { OrderOutboxOrmEntity } from '@order/infrastructure/persistence/entities/order-outbox.orm-entity';
import { OrderSagaOrmEntity } from '@order/infrastructure/persistence/entities/order-saga.orm-entity';
import { ProcessedEventOrmEntity } from '@order/infrastructure/persistence/entities/processed-event.orm-entity';
import { TypeOrmIdempotencyRepository } from '@order/infrastructure/persistence/repositories/typeorm-idempotency.repository';
import { TypeOrmOrderRepository } from '@order/infrastructure/persistence/repositories/typeorm-order.repository';
import { TypeOrmOrderSagaRepository } from '@order/infrastructure/persistence/repositories/typeorm-order-saga.repository';
import { TypeOrmTransactionAdapter } from '@order/infrastructure/persistence/transaction/typeorm-transaction.adapter';
import { buildDataSourceOptions } from '@order/infrastructure/persistence/typeorm-options';

/**
 * Owns the order Postgres connection + binds the domain repository ports (order,
 * idempotency, saga, outbox, dedupe store) to their TypeORM adapters. Any module
 * needing these ports imports this module.
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
    TypeOrmModule.forFeature([
      OrderOrmEntity,
      OrderItemOrmEntity,
      IdempotencyKeyOrmEntity,
      OrderOutboxOrmEntity,
      OrderSagaOrmEntity,
      ProcessedEventOrmEntity,
    ]),
  ],
  providers: [
    { provide: ORDER_REPOSITORY, useClass: TypeOrmOrderRepository },
    { provide: IDEMPOTENCY_REPOSITORY, useClass: TypeOrmIdempotencyRepository },
    { provide: ORDER_SAGA_REPOSITORY, useClass: TypeOrmOrderSagaRepository },
    { provide: TRANSACTION_PORT, useClass: TypeOrmTransactionAdapter },
    { provide: PROCESSED_EVENT_STORE, useClass: TypeOrmProcessedEventStore },
    TypeOrmOrderOutboxAdapter,
    { provide: OUTBOX_WRITER, useExisting: TypeOrmOrderOutboxAdapter },
    { provide: OUTBOX_PORT, useExisting: TypeOrmOrderOutboxAdapter },
  ],
  exports: [
    ORDER_REPOSITORY,
    IDEMPOTENCY_REPOSITORY,
    ORDER_SAGA_REPOSITORY,
    TRANSACTION_PORT,
    PROCESSED_EVENT_STORE,
    OUTBOX_WRITER,
    OUTBOX_PORT,
  ],
})
export class PersistenceModule {}
