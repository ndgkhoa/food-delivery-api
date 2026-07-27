import { CreateMenuItemHandler } from '@catalog/application/menu-item/commands/create-menu-item.handler';
import { DeleteMenuItemHandler } from '@catalog/application/menu-item/commands/delete-menu-item.handler';
import { UpdateMenuItemHandler } from '@catalog/application/menu-item/commands/update-menu-item.handler';
import { GetMenuItemHandler } from '@catalog/application/menu-item/queries/get-menu-item.handler';
import { ListMenuItemsHandler } from '@catalog/application/menu-item/queries/list-menu-items.handler';
import { CreateRestaurantHandler } from '@catalog/application/restaurant/commands/create-restaurant.handler';
import { DeleteRestaurantHandler } from '@catalog/application/restaurant/commands/delete-restaurant.handler';
import { UpdateRestaurantHandler } from '@catalog/application/restaurant/commands/update-restaurant.handler';
import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import { ListRestaurantsHandler } from '@catalog/application/restaurant/queries/list-restaurants.handler';
import { AuditModule } from '@catalog/infrastructure/audit/audit.module';
import { PersistenceModule } from '@catalog/infrastructure/persistence/persistence.module';
import { TenancyModule } from '@catalog/infrastructure/tenancy/tenancy.module';
import { TenantContextInterceptor } from '@catalog/infrastructure/tenancy/tenant-context.interceptor';
import { MenuItemsController } from '@catalog/interface/http/menu-items.controller';
import { RestaurantsController } from '@catalog/interface/http/restaurants.controller';
import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

/**
 * Composition root: wires ports (domain) to adapters (infrastructure),
 * registers application use-case handlers as providers, and registers HTTP
 * controllers (interface). This is the only file allowed to import across
 * all layers — see dependency-cruiser layer rules in `.dependency-cruiser.js`.
 */
@Module({
  imports: [
    SharedConfigModule.forRoot(),
    SharedLoggingModule.forRoot(),
    PersistenceModule,
    TenancyModule,
    AuditModule,
  ],
  controllers: [RestaurantsController, MenuItemsController],
  providers: [
    // Restaurant use cases
    CreateRestaurantHandler,
    UpdateRestaurantHandler,
    DeleteRestaurantHandler,
    ListRestaurantsHandler,
    GetRestaurantHandler,
    // Menu item use cases
    CreateMenuItemHandler,
    UpdateMenuItemHandler,
    DeleteMenuItemHandler,
    ListMenuItemsHandler,
    GetMenuItemHandler,
    // Every route is tenant-scoped by default — see infrastructure/tenancy/tenant-context.interceptor.ts.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
