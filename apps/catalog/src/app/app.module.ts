import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { MenuItemsModule } from '../menu-items/menu-items.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { TenantContextInterceptor } from '../tenancy/tenant-context.interceptor';

@Module({
  imports: [
    SharedConfigModule.forRoot(),
    SharedLoggingModule.forRoot(),
    DatabaseModule,
    TenancyModule,
    AuditModule,
    RestaurantsModule,
    MenuItemsModule,
  ],
  providers: [
    // Every route is tenant-scoped by default — see tenancy/tenant-context.interceptor.ts.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
