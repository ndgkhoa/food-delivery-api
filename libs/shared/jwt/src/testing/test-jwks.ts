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

export const TEST_TENANT_ID = '33333333-3333-4333-8333-333333333333';

export interface SignOptions {
  sub?: string;
  tenantId?: string;
  roles?: string[];
  issuer?: string;
  audience?: string;
  expiresInSec?: number;
  extraClaims?: Record<string, unknown>;
}

export interface TestKeySet {
  kid: string;
  issuer: string;
  audience: string;
  jwks: { keys: JWK[] };
  keyResolver: JwksKeyResolver;
  sign(options?: SignOptions): Promise<string>;
  signWithWrongKey(options?: SignOptions): Promise<string>;
}

export async function createTestKeySet(config: {
  issuer: string;
  audience: string;
  kid?: string;
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
