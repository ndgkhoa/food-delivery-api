import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';

/**
 * Resolves the signing key for a JWT from a JWK set. Any function of this
 * shape works — `jose`'s remote set (prod) or local set (tests) both satisfy it.
 */
export type JwksKeyResolver = JWTVerifyGetKey;

/**
 * Builds a resolver backed by a remote JWKS endpoint. `jose` keeps the fetched
 * keys in an in-memory cache (refreshed after `cacheMaxAgeMs`) and rate-limits
 * refetches (`cooldownDuration`) so a burst of unknown-`kid` tokens cannot
 * hammer the IdP — giving offline, sub-millisecond verification after warmup.
 */
export function createRemoteJwksResolver(
  jwksUri: string,
  cacheMaxAgeMs = 600_000,
): JwksKeyResolver {
  return createRemoteJWKSet(new URL(jwksUri), {
    cacheMaxAge: cacheMaxAgeMs,
    cooldownDuration: 30_000,
  });
}
