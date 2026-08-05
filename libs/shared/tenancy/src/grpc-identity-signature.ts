import { createHmac, timingSafeEqual } from 'node:crypto';

function canonicalString(tenantId: string, ts: number): string {
  return `grpc\n${tenantId}\n${ts}`;
}

export function signGrpcTenant(key: string, tenantId: string, ts: number): string {
  return createHmac('sha256', key).update(canonicalString(tenantId, ts)).digest('hex');
}

export type GrpcTenantVerification = { ok: true } | { ok: false; reason: string };

export interface GrpcTenantVerifierOptions {
  key: string | undefined;
  enforced: boolean;
  maxSkewMs: number;
}

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
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, reason: 'signature mismatch' };
    }

    return { ok: true };
  }
}

export const GRPC_TENANT_VERIFIER = Symbol('GrpcTenantVerifier');
