import { Inject, Injectable } from '@nestjs/common';
import { type JWTPayload, jwtVerify } from 'jose';
import { extractIdentity, type VerifiedIdentity } from './identity';
import type { JwksKeyResolver } from './jwks-resolver';
import { JWKS_KEY_RESOLVER, JWT_VERIFICATION_OPTIONS } from './jwt-verification.constants';
import type { JwtVerificationOptions } from './jwt-verification-options';

export interface VerifyAccessTokenDeps {
  keyResolver: JwksKeyResolver;
  issuer: string;
  audience: string;
  clockToleranceSec?: number;
}

export async function verifyAccessToken(
  token: string,
  deps: VerifyAccessTokenDeps,
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, deps.keyResolver, {
    algorithms: ['RS256'],
    issuer: deps.issuer,
    audience: deps.audience,
    clockTolerance: deps.clockToleranceSec ?? 5,
  });
  return payload;
}

@Injectable()
export class AccessTokenVerifier {
  constructor(
    @Inject(JWKS_KEY_RESOLVER) private readonly keyResolver: JwksKeyResolver,
    @Inject(JWT_VERIFICATION_OPTIONS) private readonly options: JwtVerificationOptions,
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
