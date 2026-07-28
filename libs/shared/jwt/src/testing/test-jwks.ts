import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  type JWK,
  type JWTPayload,
  type KeyLike,
  SignJWT,
} from 'jose';
import type { JwksKeyResolver } from '../jwks-resolver';

/** A valid v4-shaped tenant UUID reused by unit + e2e tests (matches the interceptor's UUID guard). */
export const TEST_TENANT_ID = '33333333-3333-4333-8333-333333333333';

export interface SignOptions {
  sub?: string;
  tenantId?: string;
  roles?: string[];
  /** Override to test issuer mismatch rejection. */
  issuer?: string;
  /** Override to test audience mismatch rejection. */
  audience?: string;
  /** Relative to now; pass a negative value to mint an already-expired token. */
  expiresInSec?: number;
  extraClaims?: Record<string, unknown>;
}

export interface TestKeySet {
  kid: string;
  issuer: string;
  audience: string;
  jwks: { keys: JWK[] };
  /** Local JWKS resolver to inject via `overrideProvider(JWKS_KEY_RESOLVER)`. */
  keyResolver: JwksKeyResolver;
  /** Signs a token with the set's private key (valid by default). */
  sign(options?: SignOptions): Promise<string>;
  /** Signs with a DIFFERENT key but the same `kid` → key lookup succeeds, signature check fails. */
  signWithWrongKey(options?: SignOptions): Promise<string>;
}

/**
 * Generates an in-memory RS256 keypair and exposes its public half as a local
 * JWK set plus token-signing helpers. Lets tests exercise real signature
 * verification (valid / bad-signature / expired / wrong-issuer / wrong-audience)
 * with zero live IdP — the resolver is injected in place of the remote one.
 */
export async function createTestKeySet(config: {
  issuer: string;
  audience: string;
  kid?: string;
  /**
   * Fixed PEM key material instead of a fresh random pair. Use when several
   * independent processes/suites must produce an IDENTICAL key set (e.g. a
   * consumer that caches the fetched JWKS by `kid` — a per-suite random key
   * under the same kid would fail every suite after the first).
   */
  keyPair?: { privateKeyPem: string; publicKeyPem: string };
}): Promise<TestKeySet> {
  const kid = config.kid ?? 'test-key-1';
  const { publicKey, privateKey } = config.keyPair
    ? {
        publicKey: await importSPKI(config.keyPair.publicKeyPem, 'RS256'),
        privateKey: await importPKCS8(config.keyPair.privateKeyPem, 'RS256'),
      }
    : await generateKeyPair('RS256');
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  const jwks = { keys: [publicJwk] };

  const buildAndSign = (signingKey: KeyLike, options: SignOptions = {}): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    const payload: JWTPayload = {
      tenant_id: options.tenantId ?? TEST_TENANT_ID,
      realm_access: { roles: options.roles ?? [] },
      ...options.extraClaims,
    };
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt(now)
      .setSubject(options.sub ?? 'test-user')
      .setIssuer(options.issuer ?? config.issuer)
      .setAudience(options.audience ?? config.audience)
      .setExpirationTime(now + (options.expiresInSec ?? 3600))
      .sign(signingKey);
  };

  return {
    kid,
    issuer: config.issuer,
    audience: config.audience,
    jwks,
    keyResolver: createLocalJWKSet(jwks),
    sign: (options) => buildAndSign(privateKey, options),
    signWithWrongKey: async (options) => {
      const foreign = await generateKeyPair('RS256');
      return buildAndSign(foreign.privateKey, options);
    },
  };
}
