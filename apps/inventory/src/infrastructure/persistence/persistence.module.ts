import { OUTBOX_PORT, PROCESSED_EVENT_STORE } from '@food-delivery-api/shared-messaging';
import { RESERVATION_REPOSITORY } from '@inventory/domain/reservation/reservation.repository';
import { OUTBOX_WRITER } from '@inventory/domain/shared/outbox.port';
import { TRANSACTION_PORT } from '@inventory/domain/shared/transaction.port';
import { STOCK_REPOSITORY } from '@inventory/domain/stock/stock.repository';
import { TypeOrmInventoryOutboxAdapter } from '@inventory/infrastructure/outbox/typeorm-inventory-outbox.adapter';
import { TypeOrmProcessedEventStore } from '@inventory/infrastructure/outbox/typeorm-processed-event.store';
import { InventoryOutboxOrmEntity } from '@inventory/infrastructure/persistence/entities/inventory-outbox.orm-entity';
import { ProcessedEventOrmEntity } from '@inventory/infrastructure/persistence/entities/processed-event.orm-entity';
import { ReservationOrmEntity } from '@inventory/infrastructure/persistence/entities/reservation.orm-entity';
import { StockOrmEntity } from '@inventory/infrastructure/persistence/entities/stock.orm-entity';
import { TypeOrmReservationRepository } from '@inventory/infrastructure/persistence/repositories/typeorm-reservation.repository';
import { TypeOrmStockRepository } from '@inventory/infrastructure/persistence/repositories/typeorm-stock.repository';
import { TypeOrmTransactionAdapter } from '@inventory/infrastructure/persistence/transaction/typeorm-transaction.adapter';
import { buildDataSourceOptions } from '@inventory/infrastructure/persistence/typeorm-options';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

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
      StockOrmEntity,
      ReservationOrmEntity,
      InventoryOutboxOrmEntity,
      ProcessedEventOrmEntity,
    ]),
  ],
  providers: [
    { provide: STOCK_REPOSITORY, useClass: TypeOrmStockRepository },
    { provide: RESERVATION_REPOSITORY, useClass: TypeOrmReservationRepository },
    { provide: TRANSACTION_PORT, useClass: TypeOrmTransactionAdapter },
    { provide: PROCESSED_EVENT_STORE, useClass: TypeOrmProcessedEventStore },
    TypeOrmInventoryOutboxAdapter,
    { provide: OUTBOX_WRITER, useExisting: TypeOrmInventoryOutboxAdapter },
    { provide: OUTBOX_PORT, useExisting: TypeOrmInventoryOutboxAdapter },
  ],
  exports: [
    STOCK_REPOSITORY,
    RESERVATION_REPOSITORY,
    TRANSACTION_PORT,
    PROCESSED_EVENT_STORE,
    OUTBOX_WRITER,
    OUTBOX_PORT,
  ],
})
export class PersistenceModule {}
