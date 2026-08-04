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

export const DEFAULT_MAX_SKEW_MS = 60_000;

function canonicalString(tenantId: string, sub: string, rolesJoined: string, ts: number): string {
  return `${tenantId}\n${sub}\n${rolesJoined}\n${ts}`;
}

export function signIdentity(key: string, identity: PropagatedIdentity, ts: number): string {
  return createHmac('sha256', key)
    .update(canonicalString(identity.tenantId, identity.sub, identity.roles.join(','), ts))
    .digest('hex');
}

export type IdentitySignatureVerification = { ok: true } | { ok: false; reason: string };

export interface IdentitySignatureVerifierOptions {
  key: string | undefined;
  enforced: boolean;
  maxSkewMs: number;
}

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
      return { ok: false, reason: 'signing key not configured' };
    }

    const tenantId = firstHeaderValue(headers[TENANT_ID_HEADER]);
    const sub = firstHeaderValue(headers[USER_ID_HEADER]);
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
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, reason: 'signature mismatch' };
    }

    return { ok: true };
  }
}

export interface IdentityEnforcementEnv {
  NODE_ENV?: string;
  INTERNAL_IDENTITY_SIGNING_KEY?: string;
  INTERNAL_IDENTITY_MAX_SKEW_MS?: string;
}

export interface ResolvedIdentityEnforcement extends IdentitySignatureVerifierOptions {
  warning?: string;
}

const UNSET_KEY_MESSAGE =
  'INTERNAL_IDENTITY_SIGNING_KEY is not set — internal identity signature verification is DISABLED; ' +
  'a caller reaching a service directly can forge x-tenant-id/x-roles and act as any tenant/role';

function resolveMaxSkewMs(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SKEW_MS;
}

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

export const IDENTITY_SIGNATURE_VERIFIER = Symbol('IdentitySignatureVerifier');
