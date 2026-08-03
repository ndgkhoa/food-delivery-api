import { GrpcTenantVerifier, signGrpcTenant } from './grpc-identity-signature';
import { signIdentity } from './identity-signature';

const KEY = 'a-test-signing-key-at-least-32-chars-long';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = 1_700_000_000_000;

describe('signGrpcTenant', () => {
  it('is deterministic for the same key/tenantId/ts', () => {
    expect(signGrpcTenant(KEY, TENANT_ID, NOW)).toBe(signGrpcTenant(KEY, TENANT_ID, NOW));
  });

  it('changes when tenantId or ts changes', () => {
    const base = signGrpcTenant(KEY, TENANT_ID, NOW);
    expect(signGrpcTenant(KEY, '22222222-2222-4222-8222-222222222222', NOW)).not.toBe(base);
    expect(signGrpcTenant(KEY, TENANT_ID, NOW + 1)).not.toBe(base);
  });
});

describe('GrpcTenantVerifier (enforced)', () => {
  const verifier = new GrpcTenantVerifier({ key: KEY, enforced: true, maxSkewMs: 60_000 });

  it('accepts a signature produced with the same key within the skew window', () => {
    const sig = signGrpcTenant(KEY, TENANT_ID, NOW);
    expect(verifier.verify(TENANT_ID, String(NOW), sig, NOW)).toEqual({ ok: true });
  });

  it('rejects a tampered tenantId (signature no longer matches)', () => {
    const sig = signGrpcTenant(KEY, TENANT_ID, NOW);
    const result = verifier.verify('22222222-2222-4222-8222-222222222222', String(NOW), sig, NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a tampered timestamp even when still within the skew window', () => {
    const sig = signGrpcTenant(KEY, TENANT_ID, NOW);
    const result = verifier.verify(TENANT_ID, String(NOW + 1), sig, NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a stale timestamp outside the skew window (replay)', () => {
    const ts = NOW - 120_000;
    const sig = signGrpcTenant(KEY, TENANT_ID, ts);
    expect(verifier.verify(TENANT_ID, String(ts), sig, NOW)).toEqual({
      ok: false,
      reason: 'timestamp outside allowed skew',
    });
  });

  it('rejects a far-future timestamp outside the skew window (clock-ahead forgery)', () => {
    const ts = NOW + 120_000;
    const sig = signGrpcTenant(KEY, TENANT_ID, ts);
    expect(verifier.verify(TENANT_ID, String(ts), sig, NOW)).toEqual({
      ok: false,
      reason: 'timestamp outside allowed skew',
    });
  });

  it('rejects a missing signature', () => {
    expect(verifier.verify(TENANT_ID, String(NOW), undefined, NOW)).toEqual({
      ok: false,
      reason: 'missing signature',
    });
  });

  it('rejects a missing or non-numeric timestamp', () => {
    const sig = signGrpcTenant(KEY, TENANT_ID, NOW);
    expect(verifier.verify(TENANT_ID, 'not-a-number', sig, NOW)).toEqual({
      ok: false,
      reason: 'missing or non-numeric timestamp',
    });
    expect(verifier.verify(TENANT_ID, undefined, sig, NOW)).toEqual({
      ok: false,
      reason: 'missing or non-numeric timestamp',
    });
  });

  it('rejects a missing tenant id', () => {
    const sig = signGrpcTenant(KEY, TENANT_ID, NOW);
    expect(verifier.verify(undefined, String(NOW), sig, NOW)).toEqual({
      ok: false,
      reason: 'missing tenant id',
    });
  });

  it('never throws on a wrong-length signature (guards timingSafeEqual)', () => {
    expect(() => verifier.verify(TENANT_ID, String(NOW), 'ab', NOW)).not.toThrow();
    expect(verifier.verify(TENANT_ID, String(NOW), 'ab', NOW)).toEqual({
      ok: false,
      reason: 'signature mismatch',
    });
  });

  it('rejects a signature produced with a different key', () => {
    const sig = signGrpcTenant('a-completely-different-signing-key-32chars', TENANT_ID, NOW);
    const result = verifier.verify(TENANT_ID, String(NOW), sig, NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects an HTTP identity signature replayed as a gRPC tenant signature (domain separation)', () => {
    // Same key, same tenantId/ts, but signed with the HTTP canonical string
    // (tenantId\nsub\nroles\nts) instead of the `grpc\n`-prefixed one — must
    // not verify, proving neither signature can be replayed as the other.
    const httpSig = signIdentity(KEY, { tenantId: TENANT_ID, sub: 'user-1', roles: [] }, NOW);
    const result = verifier.verify(TENANT_ID, String(NOW), httpSig, NOW);
    expect(result.ok).toBe(false);
  });
});

describe('GrpcTenantVerifier (not enforced)', () => {
  const verifier = new GrpcTenantVerifier({ key: KEY, enforced: false, maxSkewMs: 60_000 });

  it('always accepts, even with no signature metadata at all (legacy/test behavior)', () => {
    expect(verifier.verify(TENANT_ID, undefined, undefined, NOW)).toEqual({ ok: true });
  });
});

describe('GrpcTenantVerifier (enforced with no key configured)', () => {
  it('fails closed rather than treating a missing key as unsigned/legacy', () => {
    const verifier = new GrpcTenantVerifier({ key: undefined, enforced: true, maxSkewMs: 60_000 });
    const sig = signGrpcTenant(KEY, TENANT_ID, NOW);
    expect(verifier.verify(TENANT_ID, String(NOW), sig, NOW)).toEqual({
      ok: false,
      reason: 'signing key not configured',
    });
  });
});
