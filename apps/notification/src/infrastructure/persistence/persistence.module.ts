import { PROCESSED_EVENT_STORE } from '@food-delivery-api/shared-messaging';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NOTIFICATION_REPOSITORY } from '@notification/domain/notification/notification.repository';
import { TRANSACTION_PORT } from '@notification/domain/shared/transaction.port';
import { NotificationOrmEntity } from '@notification/infrastructure/persistence/entities/notification.orm-entity';
import { ProcessedEventOrmEntity } from '@notification/infrastructure/persistence/entities/processed-event.orm-entity';
import { TypeOrmNotificationRepository } from '@notification/infrastructure/persistence/repositories/typeorm-notification.repository';
import { TypeOrmProcessedEventStore } from '@notification/infrastructure/persistence/repositories/typeorm-processed-event.store';
import { TypeOrmTransactionAdapter } from '@notification/infrastructure/persistence/transaction/typeorm-transaction.adapter';
import { buildDataSourceOptions } from '@notification/infrastructure/persistence/typeorm-options';

/**
 * Owns the notification Postgres connection + binds the notification
 * repository, dedupe store, and transaction ports to their TypeORM adapters.
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
    TypeOrmModule.forFeature([NotificationOrmEntity, ProcessedEventOrmEntity]),
  ],
  providers: [
    { provide: TRANSACTION_PORT, useClass: TypeOrmTransactionAdapter },
    { provide: PROCESSED_EVENT_STORE, useClass: TypeOrmProcessedEventStore },
    { provide: NOTIFICATION_REPOSITORY, useClass: TypeOrmNotificationRepository },
  ],
  exports: [TRANSACTION_PORT, PROCESSED_EVENT_STORE, NOTIFICATION_REPOSITORY],
})
export class PersistenceModule {}
