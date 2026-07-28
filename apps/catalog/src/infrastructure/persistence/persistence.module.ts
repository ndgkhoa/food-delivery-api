import { MENU_ITEM_REPOSITORY } from '@catalog/domain/menu-item/menu-item.repository';
import { READ_MENU_ITEM_REPOSITORY } from '@catalog/domain/read-model/read-menu-item.repository';
import { READ_RESTAURANT_REPOSITORY } from '@catalog/domain/read-model/read-restaurant.repository';
import { RESTAURANT_REPOSITORY } from '@catalog/domain/restaurant/restaurant.repository';
import { OUTBOX_PORT } from '@catalog/domain/shared/outbox.port';
import { TRANSACTION_PORT } from '@catalog/domain/shared/transaction.port';
import { TypeOrmOutboxAdapter } from '@catalog/infrastructure/outbox/typeorm-outbox.adapter';
import { TypeOrmProcessedEventStore } from '@catalog/infrastructure/outbox/typeorm-processed-event.store';
import { AuditLogOrmEntity } from '@catalog/infrastructure/persistence/entities/audit-log.orm-entity';
import { MenuItemOrmEntity } from '@catalog/infrastructure/persistence/entities/menu-item.orm-entity';
import { OutboxOrmEntity } from '@catalog/infrastructure/persistence/entities/outbox.orm-entity';
import { ProcessedEventOrmEntity } from '@catalog/infrastructure/persistence/entities/processed-event.orm-entity';
import { ReadMenuItemOrmEntity } from '@catalog/infrastructure/persistence/entities/read-menu-item.orm-entity';
import { ReadRestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/read-restaurant.orm-entity';
import { RestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/restaurant.orm-entity';
import { TypeOrmMenuItemRepository } from '@catalog/infrastructure/persistence/repositories/typeorm-menu-item.repository';
import { TypeOrmReadMenuItemRepository } from '@catalog/infrastructure/persistence/repositories/typeorm-read-menu-item.repository';
import { TypeOrmReadRestaurantRepository } from '@catalog/infrastructure/persistence/repositories/typeorm-read-restaurant.repository';
import { TypeOrmRestaurantRepository } from '@catalog/infrastructure/persistence/repositories/typeorm-restaurant.repository';
import { TypeOrmTransactionAdapter } from '@catalog/infrastructure/persistence/transaction/typeorm-transaction.adapter';
import { buildDataSourceOptions } from '@catalog/infrastructure/persistence/typeorm-options';
import { PROCESSED_EVENT_STORE } from '@food-delivery-api/shared-messaging';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * Owns the Postgres connection + binds the domain repository ports (write
 * model, read model, outbox, dedupe store) to their TypeORM adapters. Any
 * module needing these ports imports this module.
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
      RestaurantOrmEntity,
      MenuItemOrmEntity,
      AuditLogOrmEntity,
      OutboxOrmEntity,
      ProcessedEventOrmEntity,
      ReadRestaurantOrmEntity,
      ReadMenuItemOrmEntity,
    ]),
  ],
  providers: [
    { provide: RESTAURANT_REPOSITORY, useClass: TypeOrmRestaurantRepository },
    { provide: MENU_ITEM_REPOSITORY, useClass: TypeOrmMenuItemRepository },
    { provide: READ_RESTAURANT_REPOSITORY, useClass: TypeOrmReadRestaurantRepository },
    { provide: READ_MENU_ITEM_REPOSITORY, useClass: TypeOrmReadMenuItemRepository },
    { provide: OUTBOX_PORT, useClass: TypeOrmOutboxAdapter },
    { provide: PROCESSED_EVENT_STORE, useClass: TypeOrmProcessedEventStore },
    { provide: TRANSACTION_PORT, useClass: TypeOrmTransactionAdapter },
  ],
  exports: [
    RESTAURANT_REPOSITORY,
    MENU_ITEM_REPOSITORY,
    READ_RESTAURANT_REPOSITORY,
    READ_MENU_ITEM_REPOSITORY,
    OUTBOX_PORT,
    PROCESSED_EVENT_STORE,
    TRANSACTION_PORT,
  ],
})
export class PersistenceModule {}
