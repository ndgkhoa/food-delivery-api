import { Global, Module } from '@nestjs/common';
import { TENANT_CONTEXT_PORT } from '../../domain/shared/tenant-context.port';
import { AlsTenantContextAdapter } from './als-tenant-context.adapter';
import { TenantContextInterceptor } from './tenant-context.interceptor';

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
