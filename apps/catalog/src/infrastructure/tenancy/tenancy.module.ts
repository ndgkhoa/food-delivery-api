import { TENANT_CONTEXT_PORT } from '@catalog/domain/shared/tenant-context.port';
import { AlsTenantContextAdapter } from '@catalog/infrastructure/tenancy/als-tenant-context.adapter';
import { TenantContextInterceptor } from '@catalog/infrastructure/tenancy/tenant-context.interceptor';
import { Global, Module } from '@nestjs/common';

/**
 * Global so every module (audit, application handlers) can inject
 * `TENANT_CONTEXT_PORT` without re-declaring this module as an import.
 */
@Global()
@Module({
  providers: [
    { provide: TENANT_CONTEXT_PORT, useClass: AlsTenantContextAdapter },
    TenantContextInterceptor,
  ],
  exports: [TENANT_CONTEXT_PORT, TenantContextInterceptor],
})
export class TenancyModule {}
