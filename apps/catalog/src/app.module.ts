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
import { EntityNotFoundFilter } from '@catalog/interface/http/filters/entity-not-found.filter';
import { MenuItemsController } from '@catalog/interface/http/menu-items.controller';
import { RestaurantsController } from '@catalog/interface/http/restaurants.controller';
import { CatalogProjectionConsumer } from '@catalog/interface/messaging/catalog-projection.consumer';
import { SharedConfigModule } from '@food-delivery-api/shared-config';
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
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

/**
 * Composition root: wires ports (domain) to adapters (infrastructure),
 * registers application use-case handlers as providers, and registers HTTP
 * controllers (interface). This is the only file allowed to import across
 * all layers — see dependency-cruiser layer rules in `.dependency-cruiser.js`.
 */
@Module({
  imports: [
    SharedConfigModule.forRoot(catalogEnvSchema),
    SharedLoggingModule.forRoot(),
    PersistenceModule,
    TenancyModule,
    AuditModule,
  ],
  controllers: [RestaurantsController, MenuItemsController, CatalogGrpcController],
  providers: [
    // Restaurant use cases. GetRestaurantHandler stays on the write model
    // (command validation); GetRestaurantViewHandler serves reads from the
    // eventually-consistent read model.
    CreateRestaurantHandler,
    UpdateRestaurantHandler,
    DeleteRestaurantHandler,
    ListRestaurantsHandler,
    GetRestaurantHandler,
    GetRestaurantViewHandler,
    // Menu item use cases
    CreateMenuItemHandler,
    UpdateMenuItemHandler,
    DeleteMenuItemHandler,
    ListMenuItemsHandler,
    GetMenuItemHandler,
    GetMenuItemsByIdsHandler,
    // Read-model projection: shared Kafka client + subscriber + the consumer
    // that tails catalog.events. Debezium emits, so no producer is registered.
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
    // Establishes tenant scope for gRPC calls from their metadata (per-controller
    // interceptor on the gRPC controller — not global, so HTTP is untouched).
    GrpcTenantContextInterceptor,
    // RBAC on write routes: the guard reads the roles the gateway verified and
    // stamped, denying writes without `restaurant-owner`/`admin`. Runs before the
    // interceptor, so reads stay open to any authenticated tenant.
    { provide: APP_GUARD, useClass: RolesGuard },
    // Every route is tenant-scoped by default — the tenant comes from the verified identity
    // the gateway propagates (shared-tenancy), never from a raw client header.
    { provide: APP_INTERCEPTOR, useClass: TrustedIdentityInterceptor },
    // Maps domain not-found errors to HTTP 404 so use cases stay transport-agnostic.
    { provide: APP_FILTER, useClass: EntityNotFoundFilter },
  ],
})
export class AppModule {}
