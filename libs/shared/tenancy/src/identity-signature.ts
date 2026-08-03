import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  firstHeaderValue,
  IDENTITY_SIG_HEADER,
  IDENTITY_TS_HEADER,
  type PropagatedIdentity,
  ROLES_HEADER,
  TENANT_ID_HEADER,
  USER_ID_HEADER,
} from './identity-headers';

/**
 * Gateway-signs and service-verifies the identity headers so a caller that
 * reaches a service directly (bypassing the gateway's JWT verification)
 * cannot forge `x-tenant-id`/`x-roles` and act as any tenant/role. Pure node
 * `crypto` — no Nest dependency — so both the gateway forwarder and every
 * service's interceptor can use it without a DI container.
 */

/** Fallback replay window when `INTERNAL_IDENTITY_MAX_SKEW_MS` is unset, non-numeric, zero, or negative. */
export const DEFAULT_MAX_SKEW_MS = 60_000;

/**
 * The exact byte string the MAC covers: every stamped value in header order
 * plus the timestamp. `rolesJoined` is the RAW `x-roles` value (already the
 * comma-joined role list the gateway stamps) — signer and verifier both feed
 * the identical string here, so verification checks the exact bytes that were
 * signed rather than a parse-then-rejoin round-trip that could drift.
 */
function canonicalString(tenantId: string, sub: string, rolesJoined: string, ts: number): string {
  return `${tenantId}\n${sub}\n${rolesJoined}\n${ts}`;
}

/** HMAC-SHA256 over the canonical identity string, hex-encoded. */
export function signIdentity(key: string, identity: PropagatedIdentity, ts: number): string {
  return createHmac('sha256', key)
    .update(canonicalString(identity.tenantId, identity.sub, identity.roles.join(','), ts))
    .digest('hex');
}

export type IdentitySignatureVerification = { ok: true } | { ok: false; reason: string };

export interface IdentitySignatureVerifierOptions {
  /** Shared HMAC secret; `undefined` means no signing key is configured (only safe when `enforced` is false). */
  key: string | undefined;
  /** When false, every request passes unconditionally — used under `NODE_ENV=test` so existing suites that stamp raw (unsigned) headers stay green. */
  enforced: boolean;
  /** Replay window in ms: how far `x-identity-ts` may drift from `now` before the request is rejected. */
  maxSkewMs: number;
}

/**
 * Verifies the HMAC signature the gateway stamped on the trusted identity
 * headers. `verify` is pure (no I/O, no throw) so callers decide how to react
 * to a rejection — the interceptor turns `{ ok: false }` into a 401 BEFORE
 * establishing tenant context, so a request never runs unscoped or mis-scoped.
 */
export class IdentitySignatureVerifier {
  private readonly key: string | undefined;
  private readonly enforced: boolean;
  private readonly maxSkewMs: number;

  constructor(options: IdentitySignatureVerifierOptions) {
    this.key = options.key;
    this.enforced = options.enforced;
    this.maxSkewMs = options.maxSkewMs;
  }

  verify(
    headers: Record<string, string | string[] | undefined>,
    now: number,
  ): IdentitySignatureVerification {
    if (!this.enforced) {
      return { ok: true };
    }
    if (!this.key) {
      // Enforced implies a key was configured when this verifier was built; a
      // missing key here is a misconfiguration, not a legitimate unsigned
      // request — fail closed rather than silently accepting it.
      return { ok: false, reason: 'signing key not configured' };
    }

    const tenantId = firstHeaderValue(headers[TENANT_ID_HEADER]);
    const sub = firstHeaderValue(headers[USER_ID_HEADER]);
    // Raw `x-roles` value (the exact bytes signed), not a parsed-then-rejoined copy.
    const rolesJoined = firstHeaderValue(headers[ROLES_HEADER]) ?? '';
    const tsValue = firstHeaderValue(headers[IDENTITY_TS_HEADER]);
    const sigValue = firstHeaderValue(headers[IDENTITY_SIG_HEADER]);

    if (!tenantId || !sub) {
      return { ok: false, reason: 'missing identity headers' };
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
      createHmac('sha256', this.key)
        .update(canonicalString(tenantId, sub, rolesJoined, ts))
        .digest('hex'),
      'hex',
    );
    const actual = Buffer.from(sigValue, 'hex');
    // Length-guard first — `timingSafeEqual` throws on unequal-length buffers,
    // and a length mismatch is itself not secret, so short-circuiting here
    // leaks nothing an attacker doesn't already know from the header they sent.
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, reason: 'signature mismatch' };
    }

    return { ok: true };
  }
}

/** The subset of `process.env` the enforcement decision reads. */
export interface IdentityEnforcementEnv {
  NODE_ENV?: string;
  INTERNAL_IDENTITY_SIGNING_KEY?: string;
  INTERNAL_IDENTITY_MAX_SKEW_MS?: string;
}

export interface ResolvedIdentityEnforcement extends IdentitySignatureVerifierOptions {
  /** Set when the service is running WITHOUT enforcement in a non-test env — the caller must surface it loudly. */
  warning?: string;
}

const UNSET_KEY_MESSAGE =
  'INTERNAL_IDENTITY_SIGNING_KEY is not set — internal identity signature verification is DISABLED; ' +
  'a caller reaching a service directly can forge x-tenant-id/x-roles and act as any tenant/role';

function resolveMaxSkewMs(raw: string | undefined): number {
  const parsed = Number(raw);
  // Reject 0, NaN, AND negatives: a negative window makes `abs(now-ts) > skew`
  // always true → every request 401s (a self-inflicted outage), so it must
  // never leak through to the verifier.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SKEW_MS;
}

/**
 * Decides enforcement from the environment — the single prod-critical gate,
 * extracted as a pure function so it is directly unit-testable (the DI factory
 * that calls it in `TenancyModule` is not). Enforcement is ON only outside
 * `NODE_ENV=test` AND with a key set. A missing key outside test is a
 * misconfiguration that silently disables the whole control, so:
 *   - in `production` it THROWS (the service must not boot unprotected);
 *   - elsewhere it returns unenforced but with a `warning` the caller logs.
 */
export function resolveIdentityEnforcement(
  env: IdentityEnforcementEnv,
): ResolvedIdentityEnforcement {
  const key = env.INTERNAL_IDENTITY_SIGNING_KEY;
  const isTest = env.NODE_ENV === 'test';
  const maxSkewMs = resolveMaxSkewMs(env.INTERNAL_IDENTITY_MAX_SKEW_MS);

  if (!isTest && !key) {
    if (env.NODE_ENV === 'production') {
      throw new Error(UNSET_KEY_MESSAGE);
    }
    return { key, enforced: false, maxSkewMs, warning: UNSET_KEY_MESSAGE };
  }

  return { key, enforced: !isTest && Boolean(key), maxSkewMs };
}

/** DI token — `TenancyModule` provides the verifier behind this so the interceptor never constructs it directly. */
export const IDENTITY_SIGNATURE_VERIFIER = Symbol('IdentitySignatureVerifier');
