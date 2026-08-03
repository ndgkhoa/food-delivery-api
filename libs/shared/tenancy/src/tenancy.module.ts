import { Global, Logger, Module } from '@nestjs/common';
import { AlsTenantContextAdapter } from './als-tenant-context.adapter';
import { GRPC_TENANT_VERIFIER, GrpcTenantVerifier } from './grpc-identity-signature';
import {
  IDENTITY_SIGNATURE_VERIFIER,
  IdentitySignatureVerifier,
  resolveIdentityEnforcement,
} from './identity-signature';
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
    {
      provide: IDENTITY_SIGNATURE_VERIFIER,
      // Reads `process.env` directly rather than a validated per-service
      // schema, mirroring the OTel `register.ts` pattern — this keeps
      // shared-tenancy decoupled from any one service's `ConfigService`.
      // Snapshotted once here (module construction), not per-request.
      useFactory: (): IdentitySignatureVerifier => {
        // Enforcement is decided in a pure, tested resolver: off under
        // `NODE_ENV=test` (existing per-service suites stamp raw, unsigned
        // headers), fails startup in production if the key is missing, and
        // warns loudly if a non-prod, non-test env runs unenforced.
        const { warning, ...options } = resolveIdentityEnforcement(process.env);
        if (warning) {
          new Logger('TenancyModule').warn(warning);
        }
        return new IdentitySignatureVerifier(options);
      },
    },
    {
      provide: GRPC_TENANT_VERIFIER,
      // Same env-driven enforcement decision as `IDENTITY_SIGNATURE_VERIFIER`
      // above (same signing key / skew window — `resolveIdentityEnforcement`
      // is the single source of truth, not duplicated here). Re-resolved
      // rather than shared via an intermediate token, keeping both providers
      // independently constructible; the startup warning is only logged once,
      // by the factory above, to avoid a duplicate log line.
      useFactory: (): GrpcTenantVerifier => {
        const { key, enforced, maxSkewMs } = resolveIdentityEnforcement(process.env);
        return new GrpcTenantVerifier({ key, enforced, maxSkewMs });
      },
    },
    TrustedIdentityInterceptor,
  ],
  // `IDENTITY_SIGNATURE_VERIFIER`/`GRPC_TENANT_VERIFIER` are exported too:
  // every service registers the interceptor as its own `APP_INTERCEPTOR`
  // (useClass), so Nest re-instantiates it in the service's injector and must
  // be able to resolve these dependencies there — an un-exported provider
  // would crash bootstrap.
  exports: [
    TENANT_CONTEXT_PORT,
    TrustedIdentityInterceptor,
    IDENTITY_SIGNATURE_VERIFIER,
    GRPC_TENANT_VERIFIER,
  ],
})
export class TenancyModule {}
