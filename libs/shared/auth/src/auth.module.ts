import { type DynamicModule, type FactoryProvider, Module } from '@nestjs/common';
import { AccessTokenVerifier } from './access-token-verifier';
import { AUTH_VERIFICATION_OPTIONS, JWKS_KEY_RESOLVER } from './auth.constants';
import type { AuthVerificationOptions } from './auth-options';
import { createRemoteJwksResolver } from './jwks-resolver';

interface AuthAsyncOptions {
  inject?: FactoryProvider['inject'];
  useFactory: (...args: never[]) => AuthVerificationOptions | Promise<AuthVerificationOptions>;
}

/**
 * Provides the `AccessTokenVerifier` wired to a JWKS resolver + issuer/audience.
 * Use `forRoot` for static config or `forRootAsync` to derive config from
 * `ConfigService`. Tests override `JWKS_KEY_RESOLVER` with a local JWK set.
 */
@Module({})
export class SharedAuthModule {
  /**
   * The JWKS resolver is a separate provider (bound to the remote set from the
   * resolved options) so tests can `overrideProvider(JWKS_KEY_RESOLVER)` with a
   * local JWK set and verify real signatures without a live IdP.
   */
  private static resolverProviders() {
    return [
      {
        provide: JWKS_KEY_RESOLVER,
        useFactory: (options: AuthVerificationOptions) => createRemoteJwksResolver(options.jwksUri),
        inject: [AUTH_VERIFICATION_OPTIONS],
      },
      AccessTokenVerifier,
    ];
  }

  static forRoot(options: AuthVerificationOptions): DynamicModule {
    return {
      module: SharedAuthModule,
      providers: [
        { provide: AUTH_VERIFICATION_OPTIONS, useValue: options },
        ...SharedAuthModule.resolverProviders(),
      ],
      exports: [AccessTokenVerifier, AUTH_VERIFICATION_OPTIONS, JWKS_KEY_RESOLVER],
    };
  }

  static forRootAsync(asyncOptions: AuthAsyncOptions): DynamicModule {
    return {
      module: SharedAuthModule,
      providers: [
        {
          provide: AUTH_VERIFICATION_OPTIONS,
          useFactory: asyncOptions.useFactory,
          inject: asyncOptions.inject ?? [],
        },
        ...SharedAuthModule.resolverProviders(),
      ],
      exports: [AccessTokenVerifier, AUTH_VERIFICATION_OPTIONS, JWKS_KEY_RESOLVER],
    };
  }
}
