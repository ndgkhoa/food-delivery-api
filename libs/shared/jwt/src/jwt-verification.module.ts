import { type DynamicModule, type FactoryProvider, Module } from '@nestjs/common';
import { AccessTokenVerifier } from './access-token-verifier';
import { createRemoteJwksResolver } from './jwks-resolver';
import { JWKS_KEY_RESOLVER, JWT_VERIFICATION_OPTIONS } from './jwt-verification.constants';
import type { JwtVerificationOptions } from './jwt-verification-options';

interface AuthAsyncOptions {
  inject?: FactoryProvider['inject'];
  useFactory: (...args: never[]) => JwtVerificationOptions | Promise<JwtVerificationOptions>;
}

/**
 * Provides the `AccessTokenVerifier` wired to a JWKS resolver + issuer/audience.
 * Use `forRoot` for static config or `forRootAsync` to derive config from
 * `ConfigService`. Tests override `JWKS_KEY_RESOLVER` with a local JWK set.
 */
@Module({})
export class JwtVerificationModule {
  /**
   * The JWKS resolver is a separate provider (bound to the remote set from the
   * resolved options) so tests can `overrideProvider(JWKS_KEY_RESOLVER)` with a
   * local JWK set and verify real signatures without a live IdP.
   */
  private static resolverProviders() {
    return [
      {
        provide: JWKS_KEY_RESOLVER,
        useFactory: (options: JwtVerificationOptions) => createRemoteJwksResolver(options.jwksUri),
        inject: [JWT_VERIFICATION_OPTIONS],
      },
      AccessTokenVerifier,
    ];
  }

  static forRoot(options: JwtVerificationOptions): DynamicModule {
    return {
      module: JwtVerificationModule,
      providers: [
        { provide: JWT_VERIFICATION_OPTIONS, useValue: options },
        ...JwtVerificationModule.resolverProviders(),
      ],
      exports: [AccessTokenVerifier, JWT_VERIFICATION_OPTIONS, JWKS_KEY_RESOLVER],
    };
  }

  static forRootAsync(asyncOptions: AuthAsyncOptions): DynamicModule {
    return {
      module: JwtVerificationModule,
      providers: [
        {
          provide: JWT_VERIFICATION_OPTIONS,
          useFactory: asyncOptions.useFactory,
          inject: asyncOptions.inject ?? [],
        },
        ...JwtVerificationModule.resolverProviders(),
      ],
      exports: [AccessTokenVerifier, JWT_VERIFICATION_OPTIONS, JWKS_KEY_RESOLVER],
    };
  }
}
