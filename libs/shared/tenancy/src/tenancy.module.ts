import { Global, Module } from '@nestjs/common';
import { AlsTenantContextAdapter } from './als-tenant-context.adapter';
import { TENANT_CONTEXT_PORT } from './tenant-context.port';
import { TrustedIdentityInterceptor } from './trusted-identity.interceptor';

/**
 * Global so every module (audit, application handlers) can inject
 * `TENANT_CONTEXT_PORT` without re-declaring this module as an import.
 * The composition root registers `TrustedIdentityInterceptor` as the
 * request-scoped `APP_INTERCEPTOR`.
 */
@Global()
@Module({
  providers: [
    { provide: TENANT_CONTEXT_PORT, useClass: AlsTenantContextAdapter },
    TrustedIdentityInterceptor,
  ],
  exports: [TENANT_CONTEXT_PORT, TrustedIdentityInterceptor],
})
export class TenancyModule {}
