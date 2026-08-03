import { OUTBOX_PORT, PROCESSED_EVENT_STORE } from '@food-delivery-api/shared-messaging';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { REVIEW_ELIGIBLE_ORDER_REPOSITORY } from '@review/domain/eligibility/review-eligible-order.repository';
import { REVIEW_REPOSITORY } from '@review/domain/review/review.repository';
import { OUTBOX_WRITER } from '@review/domain/shared/outbox.port';
import { TRANSACTION_PORT } from '@review/domain/shared/transaction.port';
import { TypeOrmReviewOutboxAdapter } from '@review/infrastructure/outbox/typeorm-review-outbox.adapter';
import { ProcessedEventOrmEntity } from '@review/infrastructure/persistence/entities/processed-event.orm-entity';
import { ReviewOrmEntity } from '@review/infrastructure/persistence/entities/review.orm-entity';
import { ReviewEligibleOrderOrmEntity } from '@review/infrastructure/persistence/entities/review-eligible-order.orm-entity';
import { ReviewOutboxOrmEntity } from '@review/infrastructure/persistence/entities/review-outbox.orm-entity';
import { TypeOrmProcessedEventStore } from '@review/infrastructure/persistence/repositories/typeorm-processed-event.store';
import { TypeOrmReviewRepository } from '@review/infrastructure/persistence/repositories/typeorm-review.repository';
import { TypeOrmReviewEligibleOrderRepository } from '@review/infrastructure/persistence/repositories/typeorm-review-eligible-order.repository';
import { TypeOrmTransactionAdapter } from '@review/infrastructure/persistence/transaction/typeorm-transaction.adapter';
import { buildDataSourceOptions } from '@review/infrastructure/persistence/typeorm-options';

/**
 * Owns the review Postgres connection + binds the domain repository ports
 * (review, eligibility, outbox, dedupe store) to their TypeORM adapters.
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
      ReviewOrmEntity,
      ReviewEligibleOrderOrmEntity,
      ReviewOutboxOrmEntity,
      ProcessedEventOrmEntity,
    ]),
  ],
  providers: [
    { provide: REVIEW_REPOSITORY, useClass: TypeOrmReviewRepository },
    { provide: REVIEW_ELIGIBLE_ORDER_REPOSITORY, useClass: TypeOrmReviewEligibleOrderRepository },
    { provide: TRANSACTION_PORT, useClass: TypeOrmTransactionAdapter },
    { provide: PROCESSED_EVENT_STORE, useClass: TypeOrmProcessedEventStore },
    TypeOrmReviewOutboxAdapter,
    { provide: OUTBOX_WRITER, useExisting: TypeOrmReviewOutboxAdapter },
    { provide: OUTBOX_PORT, useExisting: TypeOrmReviewOutboxAdapter },
  ],
  exports: [
    REVIEW_REPOSITORY,
    REVIEW_ELIGIBLE_ORDER_REPOSITORY,
    TRANSACTION_PORT,
    PROCESSED_EVENT_STORE,
    OUTBOX_WRITER,
    OUTBOX_PORT,
  ],
})
export class PersistenceModule {}
