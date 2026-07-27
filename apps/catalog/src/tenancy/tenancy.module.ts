import { Global, Module } from '@nestjs/common';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { TenantContextService } from './tenant-context.service';

/**
 * Global so every feature module (restaurants, menu-items, audit) can inject
 * `TenantContextService` without re-declaring this module as an import.
 */
@Global()
@Module({
  providers: [TenantContextService, TenantContextInterceptor],
  exports: [TenantContextService, TenantContextInterceptor],
})
export class TenancyModule {}
