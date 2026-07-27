import { AccessTokenVerifier, verifyAccessToken } from './access-token-verifier';
import { createTestKeySet, TEST_TENANT_ID, type TestKeySet } from './testing/test-jwks';

const ISSUER = 'https://idp.test/realms/food-delivery';
const AUDIENCE = 'food-delivery-api';

describe('access token verification', () => {
  let keys: TestKeySet;

  beforeAll(async () => {
    keys = await createTestKeySet({ issuer: ISSUER, audience: AUDIENCE });
  });

  const verify = (token: string) =>
    verifyAccessToken(token, { keyResolver: keys.keyResolver, issuer: ISSUER, audience: AUDIENCE });

  it('accepts a valid RS256 token signed by the JWKS key', async () => {
    const token = await keys.sign({ sub: 'user-1', roles: ['customer'] });
    const payload = await verify(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.tenant_id).toBe(TEST_TENANT_ID);
  });

  it('rejects a token with a broken signature', async () => {
    const token = await keys.signWithWrongKey();
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await keys.sign({ expiresInSec: -60 });
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a token from the wrong issuer', async () => {
    const token = await keys.sign({ issuer: 'https://evil.test/realms/attacker' });
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a token for the wrong audience', async () => {
    const token = await keys.sign({ audience: 'some-other-api' });
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a forged alg:none token (algorithm pinned to RS256)', async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const header = enc({ alg: 'none', typ: 'JWT', kid: keys.kid });
    const body = enc({
      sub: 'attacker',
      tenant_id: TEST_TENANT_ID,
      iss: ISSUER,
      aud: AUDIENCE,
      exp: now + 3600,
    });
    const forged = `${header}.${body}.`; // unsigned "none" token
    await expect(verify(forged)).rejects.toThrow();
  });

  describe('AccessTokenVerifier (DI wrapper)', () => {
    it('returns the extracted identity for a valid token', async () => {
      const verifier = new AccessTokenVerifier(keys.keyResolver, {
        jwksUri: 'unused-in-test',
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      const token = await keys.sign({ sub: 'owner-7', roles: ['restaurant-owner'] });

      const identity = await verifier.verify(token);

      expect(identity).toEqual({
        sub: 'owner-7',
        tenantId: TEST_TENANT_ID,
        roles: ['restaurant-owner'],
      });
    });
  });
});
