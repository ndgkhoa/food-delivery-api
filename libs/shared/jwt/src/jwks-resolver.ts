import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';

export type JwksKeyResolver = JWTVerifyGetKey;

export function createRemoteJwksResolver(
  jwksUri: string,
  cacheMaxAgeMs = 600_000,
): JwksKeyResolver {
  return createRemoteJWKSet(new URL(jwksUri), {
    cacheMaxAge: cacheMaxAgeMs,
    cooldownDuration: 30_000,
  });
}
