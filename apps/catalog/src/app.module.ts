import { CreateMenuItemHandler } from '@catalog/application/menu-item/commands/create-menu-item.handler';
import { DeleteMenuItemHandler } from '@catalog/application/menu-item/commands/delete-menu-item.handler';
import { UpdateMenuItemHandler } from '@catalog/application/menu-item/commands/update-menu-item.handler';
import { GetMenuItemHandler } from '@catalog/application/menu-item/queries/get-menu-item.handler';
import { GetMenuItemsByIdsHandler } from '@catalog/application/menu-item/queries/get-menu-items-by-ids.handler';
import { ListMenuItemsHandler } from '@catalog/application/menu-item/queries/list-menu-items.handler';
import { CreateRestaurantHandler } from '@catalog/application/restaurant/commands/create-restaurant.handler';
import { DeleteRestaurantHandler } from '@catalog/application/restaurant/commands/delete-restaurant.handler';
import { UpdateRestaurantHandler } from '@catalog/application/restaurant/commands/update-restaurant.handler';
import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import { GetRestaurantViewHandler } from '@catalog/application/restaurant/queries/get-restaurant-view.handler';
import { ListRestaurantsHandler } from '@catalog/application/restaurant/queries/list-restaurants.handler';
import { catalogEnvSchema } from '@catalog/config/catalog-env-schema';
import { AuditModule } from '@catalog/infrastructure/audit/audit.module';
import { PersistenceModule } from '@catalog/infrastructure/persistence/persistence.module';
import { CatalogGrpcController } from '@catalog/interface/grpc/catalog.grpc.controller';
import { GrpcTenantContextInterceptor } from '@catalog/interface/grpc/grpc-tenant-context.interceptor';
import { CacheStatsController } from '@catalog/interface/http/cache-stats.controller';
import { MenuItemsController } from '@catalog/interface/http/menu-items.controller';
import { RestaurantsController } from '@catalog/interface/http/restaurants.controller';
import { CatalogProjectionConsumer } from '@catalog/interface/messaging/catalog-projection.consumer';
import { ReviewProjectionConsumer } from '@catalog/interface/messaging/review-projection.consumer';
import { CacheModule } from '@food-delivery-api/shared-cache';
import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { HealthModule } from '@food-delivery-api/shared-health';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import {
  createKafkaClient,
  KAFKA_CLIENT,
  KafkaConsumerSubscriber,
} from '@food-delivery-api/shared-messaging';
import {
  RolesGuard,
  TenancyModule,
  TrustedIdentityInterceptor,
} from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  imports: [
    SharedConfigModule.forRoot(catalogEnvSchema),
    SharedLoggingModule.forRoot(),
    HealthModule,
    PersistenceModule,
    TenancyModule,
    AuditModule,
    CacheModule.forRoot({ redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379' }),
  ],
  controllers: [
    RestaurantsController,
    MenuItemsController,
    CatalogGrpcController,
    CacheStatsController,
  ],
  providers: [
    CreateRestaurantHandler,
    UpdateRestaurantHandler,
    DeleteRestaurantHandler,
    ListRestaurantsHandler,
    GetRestaurantHandler,
    GetRestaurantViewHandler,
    CreateMenuItemHandler,
    UpdateMenuItemHandler,
    DeleteMenuItemHandler,
    ListMenuItemsHandler,
    GetMenuItemHandler,
    GetMenuItemsByIdsHandler,
    {
      provide: KAFKA_CLIENT,
      useFactory: (config: ConfigService) =>
        createKafkaClient({
          clientId: config.getOrThrow<string>('KAFKA_CLIENT_ID'),
          brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
        }),
      inject: [ConfigService],
    },
    KafkaConsumerSubscriber,
    CatalogProjectionConsumer,
    ReviewProjectionConsumer,
    GrpcTenantContextInterceptor,
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TrustedIdentityInterceptor },
  ],
})
export class AppModule {}
