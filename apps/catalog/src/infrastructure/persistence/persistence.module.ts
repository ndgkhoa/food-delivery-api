import { MENU_ITEM_REPOSITORY } from '@catalog/domain/menu-item/menu-item.repository';
import { RESTAURANT_REPOSITORY } from '@catalog/domain/restaurant/restaurant.repository';
import { AuditLogOrmEntity } from '@catalog/infrastructure/persistence/entities/audit-log.orm-entity';
import { MenuItemOrmEntity } from '@catalog/infrastructure/persistence/entities/menu-item.orm-entity';
import { RestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/restaurant.orm-entity';
import { TypeOrmMenuItemRepository } from '@catalog/infrastructure/persistence/repositories/typeorm-menu-item.repository';
import { TypeOrmRestaurantRepository } from '@catalog/infrastructure/persistence/repositories/typeorm-restaurant.repository';
import { buildDataSourceOptions } from '@catalog/infrastructure/persistence/typeorm-options';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * Owns the Postgres connection + binds the domain repository ports to their
 * TypeORM adapters. Any module needing `RESTAURANT_REPOSITORY` /
 * `MENU_ITEM_REPOSITORY` imports this module.
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
    TypeOrmModule.forFeature([RestaurantOrmEntity, MenuItemOrmEntity, AuditLogOrmEntity]),
  ],
  providers: [
    { provide: RESTAURANT_REPOSITORY, useClass: TypeOrmRestaurantRepository },
    { provide: MENU_ITEM_REPOSITORY, useClass: TypeOrmMenuItemRepository },
  ],
  exports: [RESTAURANT_REPOSITORY, MENU_ITEM_REPOSITORY],
})
export class PersistenceModule {}
