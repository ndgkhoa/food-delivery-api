import {
  IDENTITY_SIG_HEADER,
  IDENTITY_TS_HEADER,
  ROLES_HEADER,
  TENANT_ID_HEADER,
  USER_ID_HEADER,
} from './identity-headers';
import {
  DEFAULT_MAX_SKEW_MS,
  IdentitySignatureVerifier,
  resolveIdentityEnforcement,
  signIdentity,
} from './identity-signature';

const KEY = 'a-test-signing-key-at-least-32-chars-long';
const IDENTITY = {
  sub: 'user-123',
  tenantId: '11111111-1111-4111-8111-111111111111',
  roles: ['restaurant-owner', 'admin'],
};
const NOW = 1_700_000_000_000;

function signedHeaders(ts: number, key = KEY): Record<string, string> {
  return {
    [TENANT_ID_HEADER]: IDENTITY.tenantId,
    [USER_ID_HEADER]: IDENTITY.sub,
    [ROLES_HEADER]: IDENTITY.roles.join(','),
    [IDENTITY_TS_HEADER]: String(ts),
    [IDENTITY_SIG_HEADER]: signIdentity(key, IDENTITY, ts),
  };
}

describe('signIdentity', () => {
  it('is deterministic for the same key/identity/ts', () => {
    expect(signIdentity(KEY, IDENTITY, NOW)).toBe(signIdentity(KEY, IDENTITY, NOW));
  });

  it('changes when any signed field changes', () => {
    const base = signIdentity(KEY, IDENTITY, NOW);
    expect(signIdentity(KEY, { ...IDENTITY, tenantId: 'other-tenant' }, NOW)).not.toBe(base);
    expect(signIdentity(KEY, { ...IDENTITY, sub: 'other-user' }, NOW)).not.toBe(base);
    expect(signIdentity(KEY, { ...IDENTITY, roles: ['admin'] }, NOW)).not.toBe(base);
    expect(signIdentity(KEY, IDENTITY, NOW + 1)).not.toBe(base);
  });
});

describe('IdentitySignatureVerifier (enforced)', () => {
  const verifier = new IdentitySignatureVerifier({ key: KEY, enforced: true, maxSkewMs: 60_000 });

  it('accepts a header set signed with the same key within the skew window', () => {
    expect(verifier.verify(signedHeaders(NOW), NOW)).toEqual({ ok: true });
  });

  it('rejects a tampered tenantId (signature no longer matches)', () => {
    const headers = signedHeaders(NOW);
    headers[TENANT_ID_HEADER] = '22222222-2222-4222-8222-222222222222';
    const result = verifier.verify(headers, NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects tampered roles (privilege escalation attempt)', () => {
    const headers = signedHeaders(NOW);
    headers[ROLES_HEADER] = 'admin,super-admin';
    const result = verifier.verify(headers, NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a tampered timestamp even when still within the skew window', () => {
    const headers = signedHeaders(NOW);
    headers[IDENTITY_TS_HEADER] = String(NOW + 1);
    const result = verifier.verify(headers, NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a stale timestamp outside the skew window (replay)', () => {
    const headers = signedHeaders(NOW - 120_000);
    const result = verifier.verify(headers, NOW);
    expect(result).toEqual({ ok: false, reason: 'timestamp outside allowed skew' });
  });

  it('rejects a far-future timestamp outside the skew window (clock-ahead forgery)', () => {
    const headers = signedHeaders(NOW + 120_000);
    const result = verifier.verify(headers, NOW);
    expect(result).toEqual({ ok: false, reason: 'timestamp outside allowed skew' });
  });

  it('verifies the raw x-roles bytes, not a parsed-then-rejoined copy', () => {
    const ts = NOW;
    const rawRoles = 'restaurant-owner,,admin';
    const headers = {
      [TENANT_ID_HEADER]: IDENTITY.tenantId,
      [USER_ID_HEADER]: IDENTITY.sub,
      [ROLES_HEADER]: rawRoles,
      [IDENTITY_TS_HEADER]: String(ts),
      [IDENTITY_SIG_HEADER]: signIdentity(
        KEY,
        { ...IDENTITY, roles: ['restaurant-owner', '', 'admin'] },
        ts,
      ),
    };
    expect(verifier.verify(headers, ts)).toEqual({ ok: true });
  });

  it('rejects a missing signature header', () => {
    const headers = signedHeaders(NOW);
    delete headers[IDENTITY_SIG_HEADER];
    expect(verifier.verify(headers, NOW)).toEqual({ ok: false, reason: 'missing signature' });
  });

  it('rejects a missing or non-numeric timestamp header', () => {
    const headers = signedHeaders(NOW);
    headers[IDENTITY_TS_HEADER] = 'not-a-number';
    expect(verifier.verify(headers, NOW)).toEqual({
      ok: false,
      reason: 'missing or non-numeric timestamp',
    });
  });

  it('never throws on a wrong-length signature (guards timingSafeEqual)', () => {
    const headers = signedHeaders(NOW);
    headers[IDENTITY_SIG_HEADER] = 'ab';
    expect(() => verifier.verify(headers, NOW)).not.toThrow();
    expect(verifier.verify(headers, NOW)).toEqual({ ok: false, reason: 'signature mismatch' });
  });

  it('rejects a signature produced with a different key', () => {
    const headers = signedHeaders(NOW, 'a-completely-different-signing-key-32chars');
    const result = verifier.verify(headers, NOW);
    expect(result.ok).toBe(false);
  });
});

describe('IdentitySignatureVerifier (not enforced)', () => {
  const verifier = new IdentitySignatureVerifier({ key: KEY, enforced: false, maxSkewMs: 60_000 });

  it('always accepts, even with no signature headers at all (legacy/test behavior)', () => {
    expect(
      verifier.verify(
        { [TENANT_ID_HEADER]: IDENTITY.tenantId, [USER_ID_HEADER]: IDENTITY.sub },
        NOW,
      ),
    ).toEqual({ ok: true });
  });
});

describe('IdentitySignatureVerifier (enforced with no key configured)', () => {
  it('fails closed rather than treating a missing key as unsigned/legacy', () => {
    const verifier = new IdentitySignatureVerifier({
      key: undefined,
      enforced: true,
      maxSkewMs: 60_000,
    });

    expect(verifier.verify(signedHeaders(NOW), NOW)).toEqual({
      ok: false,
      reason: 'signing key not configured',
    });
  });
});

describe('resolveIdentityEnforcement (the prod-critical gate)', () => {
  it('is OFF under NODE_ENV=test so existing raw-header suites stay green', () => {
    const resolved = resolveIdentityEnforcement({ NODE_ENV: 'test' });
    expect(resolved.enforced).toBe(false);
    expect(resolved.warning).toBeUndefined();
  });

  it('is ON outside test when a key is set', () => {
    const resolved = resolveIdentityEnforcement({
      NODE_ENV: 'development',
      INTERNAL_IDENTITY_SIGNING_KEY: KEY,
    });
    expect(resolved).toMatchObject({ enforced: true, key: KEY });
    expect(resolved.warning).toBeUndefined();
  });

  it('runs UNENFORCED with a loud warning when a non-prod env has no key', () => {
    const resolved = resolveIdentityEnforcement({ NODE_ENV: 'development' });
    expect(resolved.enforced).toBe(false);
    expect(resolved.warning).toContain('INTERNAL_IDENTITY_SIGNING_KEY is not set');
  });

  it('THROWS at startup when production has no key (never boot unprotected)', () => {
    expect(() => resolveIdentityEnforcement({ NODE_ENV: 'production' })).toThrow(
      /INTERNAL_IDENTITY_SIGNING_KEY is not set/,
    );
  });

  it('does not throw in production when a key is set', () => {
    const resolved = resolveIdentityEnforcement({
      NODE_ENV: 'production',
      INTERNAL_IDENTITY_SIGNING_KEY: KEY,
    });
    expect(resolved.enforced).toBe(true);
  });

  it('falls back to the default window for unset, zero, negative, or non-numeric skew', () => {
    const base = { NODE_ENV: 'development', INTERNAL_IDENTITY_SIGNING_KEY: KEY };
    expect(resolveIdentityEnforcement(base).maxSkewMs).toBe(DEFAULT_MAX_SKEW_MS);
    for (const bad of ['0', '-5000', 'abc']) {
      expect(
        resolveIdentityEnforcement({ ...base, INTERNAL_IDENTITY_MAX_SKEW_MS: bad }).maxSkewMs,
      ).toBe(DEFAULT_MAX_SKEW_MS);
    }
  });

  it('uses a valid positive skew override', () => {
    const resolved = resolveIdentityEnforcement({
      NODE_ENV: 'development',
      INTERNAL_IDENTITY_SIGNING_KEY: KEY,
      INTERNAL_IDENTITY_MAX_SKEW_MS: '5000',
    });
    expect(resolved.maxSkewMs).toBe(5000);
  });
});
