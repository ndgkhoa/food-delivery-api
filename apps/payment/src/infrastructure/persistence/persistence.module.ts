import { OUTBOX_PORT, PROCESSED_EVENT_STORE } from '@food-delivery-api/shared-messaging';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OUTBOX_WRITER } from '@payment/domain/shared/outbox.port';
import { TRANSACTION_PORT } from '@payment/domain/shared/transaction.port';
import { TypeOrmPaymentOutboxAdapter } from '@payment/infrastructure/outbox/typeorm-payment-outbox.adapter';
import { TypeOrmProcessedEventStore } from '@payment/infrastructure/outbox/typeorm-processed-event.store';
import { PaymentOutboxOrmEntity } from '@payment/infrastructure/persistence/entities/payment-outbox.orm-entity';
import { ProcessedEventOrmEntity } from '@payment/infrastructure/persistence/entities/processed-event.orm-entity';
import { TypeOrmTransactionAdapter } from '@payment/infrastructure/persistence/transaction/typeorm-transaction.adapter';
import { buildDataSourceOptions } from '@payment/infrastructure/persistence/typeorm-options';

/**
 * Owns the payment Postgres connection + binds the outbox writer, dedupe store,
 * and transaction ports to their TypeORM adapters. No domain-table repositories
 * yet — the stub only persists its outbox + dedupe ledger.
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
    TypeOrmModule.forFeature([PaymentOutboxOrmEntity, ProcessedEventOrmEntity]),
  ],
  providers: [
    { provide: TRANSACTION_PORT, useClass: TypeOrmTransactionAdapter },
    { provide: PROCESSED_EVENT_STORE, useClass: TypeOrmProcessedEventStore },
    TypeOrmPaymentOutboxAdapter,
    { provide: OUTBOX_WRITER, useExisting: TypeOrmPaymentOutboxAdapter },
    { provide: OUTBOX_PORT, useExisting: TypeOrmPaymentOutboxAdapter },
  ],
  exports: [TRANSACTION_PORT, PROCESSED_EVENT_STORE, OUTBOX_WRITER, OUTBOX_PORT],
})
export class PersistenceModule {}
