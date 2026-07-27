import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CreateMenuItemHandler } from './application/menu-item/commands/create-menu-item.handler';
import { DeleteMenuItemHandler } from './application/menu-item/commands/delete-menu-item.handler';
import { UpdateMenuItemHandler } from './application/menu-item/commands/update-menu-item.handler';
import { GetMenuItemHandler } from './application/menu-item/queries/get-menu-item.handler';
import { ListMenuItemsHandler } from './application/menu-item/queries/list-menu-items.handler';
import { CreateRestaurantHandler } from './application/restaurant/commands/create-restaurant.handler';
import { DeleteRestaurantHandler } from './application/restaurant/commands/delete-restaurant.handler';
import { UpdateRestaurantHandler } from './application/restaurant/commands/update-restaurant.handler';
import { GetRestaurantHandler } from './application/restaurant/queries/get-restaurant.handler';
import { ListRestaurantsHandler } from './application/restaurant/queries/list-restaurants.handler';
import { AuditModule } from './infrastructure/audit/audit.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { TenancyModule } from './infrastructure/tenancy/tenancy.module';
import { TenantContextInterceptor } from './infrastructure/tenancy/tenant-context.interceptor';
import { MenuItemsController } from './interface/http/menu-items.controller';
import { RestaurantsController } from './interface/http/restaurants.controller';

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
