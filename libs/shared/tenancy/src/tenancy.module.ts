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

@Global()
@Module({
  providers: [
    { provide: TENANT_CONTEXT_PORT, useClass: AlsTenantContextAdapter },
    {
      provide: IDENTITY_SIGNATURE_VERIFIER,
      useFactory: (): IdentitySignatureVerifier => {
        const { warning, ...options } = resolveIdentityEnforcement(process.env);
        if (warning) {
          new Logger('TenancyModule').warn(warning);
        }
        return new IdentitySignatureVerifier(options);
      },
    },
    {
      provide: GRPC_TENANT_VERIFIER,
      useFactory: (): GrpcTenantVerifier => {
        const { key, enforced, maxSkewMs } = resolveIdentityEnforcement(process.env);
        return new GrpcTenantVerifier({ key, enforced, maxSkewMs });
      },
    },
    TrustedIdentityInterceptor,
  ],
  exports: [
    TENANT_CONTEXT_PORT,
    TrustedIdentityInterceptor,
    IDENTITY_SIGNATURE_VERIFIER,
    GRPC_TENANT_VERIFIER,
  ],
})
export class TenancyModule {}
