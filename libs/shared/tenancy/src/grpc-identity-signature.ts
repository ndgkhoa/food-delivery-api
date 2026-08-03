import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC signing for the east-west gRPC tenant metadata — the gRPC counterpart
 * of `identity-signature.ts`'s HTTP header signing. A service that reaches
 * catalog/inventory directly (bypassing order's producer) can't forge
 * `x-tenant-id` on the gRPC channel any more than it could forge the HTTP
 * identity headers. The `grpc\n` prefix domain-separates the canonical string
 * from the HTTP identity signature's `tenantId\nsub\nroles\nts` so, even
 * though both share the same signing key, an HTTP identity signature can
 * never be replayed as a gRPC tenant signature or vice versa.
 */

/** The exact byte string the MAC covers: a fixed domain tag, the tenant id, and the timestamp. */
function canonicalString(tenantId: string, ts: number): string {
  return `grpc\n${tenantId}\n${ts}`;
}

/** HMAC-SHA256 over the canonical gRPC tenant string, hex-encoded. */
export function signGrpcTenant(key: string, tenantId: string, ts: number): string {
  return createHmac('sha256', key).update(canonicalString(tenantId, ts)).digest('hex');
}

export type GrpcTenantVerification = { ok: true } | { ok: false; reason: string };

export interface GrpcTenantVerifierOptions {
  /** Shared HMAC secret; `undefined` means no signing key is configured (only safe when `enforced` is false). */
  key: string | undefined;
  /** When false, every call passes unconditionally — used under `NODE_ENV=test` so existing suites that stamp unsigned metadata stay green. */
  enforced: boolean;
  /** Replay window in ms: how far the gRPC timestamp may drift from `now` before the call is rejected. */
  maxSkewMs: number;
}

/**
 * Verifies the HMAC signature order stamps on the gRPC tenant metadata.
 * `verify` is pure (no I/O, no throw) so callers decide how to react to a
 * rejection — the gRPC interceptors turn `{ ok: false }` into UNAUTHENTICATED
 * BEFORE establishing tenant context, so a call never runs unscoped or
 * mis-scoped.
 */
export class GrpcTenantVerifier {
  private readonly key: string | undefined;
  private readonly enforced: boolean;
  private readonly maxSkewMs: number;

  constructor(options: GrpcTenantVerifierOptions) {
    this.key = options.key;
    this.enforced = options.enforced;
    this.maxSkewMs = options.maxSkewMs;
  }

  verify(
    tenantId: string | undefined,
    tsValue: string | undefined,
    sigValue: string | undefined,
    now: number,
  ): GrpcTenantVerification {
    if (!this.enforced) {
      return { ok: true };
    }
    if (!this.key) {
      // Enforced implies a key was configured when this verifier was built; a
      // missing key here is a misconfiguration, not a legitimate unsigned
      // call — fail closed rather than silently accepting it.
      return { ok: false, reason: 'signing key not configured' };
    }
    if (!tenantId) {
      return { ok: false, reason: 'missing tenant id' };
    }
    if (!tsValue || !/^\d+$/.test(tsValue)) {
      return { ok: false, reason: 'missing or non-numeric timestamp' };
    }
    if (!sigValue) {
      return { ok: false, reason: 'missing signature' };
    }

    const ts = Number(tsValue);
    if (Math.abs(now - ts) > this.maxSkewMs) {
      return { ok: false, reason: 'timestamp outside allowed skew' };
    }

    const expected = Buffer.from(
      createHmac('sha256', this.key).update(canonicalString(tenantId, ts)).digest('hex'),
      'hex',
    );
    const actual = Buffer.from(sigValue, 'hex');
    // Length-guard first — `timingSafeEqual` throws on unequal-length buffers,
    // and a length mismatch is itself not secret, so short-circuiting here
    // leaks nothing an attacker doesn't already know from the metadata it sent.
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, reason: 'signature mismatch' };
    }

    return { ok: true };
  }
}

/** DI token — `TenancyModule` provides the verifier behind this so interceptors never construct it directly. */
export const GRPC_TENANT_VERIFIER = Symbol('GrpcTenantVerifier');
