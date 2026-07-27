import { Inject, Injectable } from '@nestjs/common';
import { type JWTPayload, jwtVerify } from 'jose';
import { AUTH_VERIFICATION_OPTIONS, JWKS_KEY_RESOLVER } from './auth.constants';
import type { AuthVerificationOptions } from './auth-options';
import { extractIdentity, type VerifiedIdentity } from './identity';
import type { JwksKeyResolver } from './jwks-resolver';

export interface VerifyAccessTokenDeps {
  keyResolver: JwksKeyResolver;
  issuer: string;
  audience: string;
  clockToleranceSec?: number;
}

/**
 * Framework-light core: offline-verifies an access token's signature, issuer,
 * audience and expiry against a JWK set, returning the raw payload. No Nest/DI
 * involved so it is trivially unit-testable with an injected local JWK set.
 */
export async function verifyAccessToken(
  token: string,
  deps: VerifyAccessTokenDeps,
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, deps.keyResolver, {
    // Pin to RS256 (Keycloak's signing algorithm) so a forged `alg: none` or an
    // HS/RS confusion token is rejected outright, before the key is ever used.
    algorithms: ['RS256'],
    issuer: deps.issuer,
    audience: deps.audience,
    clockTolerance: deps.clockToleranceSec ?? 5,
  });
  return payload;
}

/**
 * Injectable wrapper around `verifyAccessToken` that binds the configured JWKS
 * resolver + issuer/audience so callers (e.g. the gateway `JwtAuthGuard`) just
 * hand it a token and get back the trusted identity.
 */
@Injectable()
export class AccessTokenVerifier {
  constructor(
    @Inject(JWKS_KEY_RESOLVER) private readonly keyResolver: JwksKeyResolver,
    @Inject(AUTH_VERIFICATION_OPTIONS) private readonly options: AuthVerificationOptions,
  ) {}

  async verify(token: string): Promise<VerifiedIdentity> {
    const payload = await verifyAccessToken(token, {
      keyResolver: this.keyResolver,
      issuer: this.options.issuer,
      audience: this.options.audience,
      clockToleranceSec: this.options.clockToleranceSec,
    });
    return extractIdentity(payload);
  }
}
