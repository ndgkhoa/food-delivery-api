import { type CallHandler, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { AlsTenantContextAdapter } from './als-tenant-context.adapter';
import {
  IDENTITY_SIG_HEADER,
  IDENTITY_TS_HEADER,
  ROLES_HEADER,
  TENANT_ID_HEADER,
  USER_ID_HEADER,
} from './identity-headers';
import { IdentitySignatureVerifier, signIdentity } from './identity-signature';
import { TrustedIdentityInterceptor } from './trusted-identity.interceptor';

const SIGNING_KEY = 'a-test-signing-key-at-least-32-chars-long';
/** Enforcement off — mirrors `NODE_ENV=test`, matching how every other service suite stamps raw headers. */
const NOT_ENFORCED_VERIFIER = new IdentitySignatureVerifier({
  key: undefined,
  enforced: false,
  maxSkewMs: 60_000,
});

function executionContextWith(headers: Record<string, string>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('TrustedIdentityInterceptor', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222';
  let adapter: AlsTenantContextAdapter;
  let interceptor: TrustedIdentityInterceptor;

  beforeEach(() => {
    adapter = new AlsTenantContextAdapter();
    interceptor = new TrustedIdentityInterceptor(adapter, NOT_ENFORCED_VERIFIER);
  });

  it('establishes tenant context from the trusted headers', async () => {
    const context = executionContextWith({
      [TENANT_ID_HEADER]: tenantId,
      [USER_ID_HEADER]: 'user-9',
    });
    const next: CallHandler = {
      handle: () => of({ tenantId: adapter.getTenantIdOrThrow(), actor: adapter.getActor() }),
    };

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({ tenantId, actor: 'user-9' });
  });

  it('propagates the trusted roles header into the tenant context', async () => {
    const context = executionContextWith({
      [TENANT_ID_HEADER]: tenantId,
      [USER_ID_HEADER]: 'user-9',
      [ROLES_HEADER]: 'restaurant-owner,admin',
    });
    const next: CallHandler = { handle: () => of(adapter.getContext()?.roles) };

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual(['restaurant-owner', 'admin']);
  });

  it('rejects a request with no verified tenant header (fails closed)', () => {
    const context = executionContextWith({});
    const next: CallHandler = { handle: () => of(null) };

    expect(() => interceptor.intercept(context, next)).toThrow(UnauthorizedException);
  });

  it('rejects a malformed tenant header', () => {
    const context = executionContextWith({ [TENANT_ID_HEADER]: 'not-a-uuid' });
    const next: CallHandler = { handle: () => of(null) };

    expect(() => interceptor.intercept(context, next)).toThrow(UnauthorizedException);
  });

  it('when signature enforcement is off, establishes context with no signature headers at all (unchanged legacy behavior)', async () => {
    const context = executionContextWith({
      [TENANT_ID_HEADER]: tenantId,
      [USER_ID_HEADER]: 'user-9',
    });
    const next: CallHandler = { handle: () => of(adapter.getContext()?.tenantId) };

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result).toBe(tenantId);
  });

  it('passes non-HTTP (e.g. gRPC) calls straight through without touching an HTTP request', async () => {
    const context = {
      getType: () => 'rpc',
      switchToHttp: () => {
        throw new Error('must not read an HTTP request for a non-HTTP call');
      },
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of('grpc-result') };

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result).toBe('grpc-result');
  });
});

describe('TrustedIdentityInterceptor (signature enforcement on)', () => {
  const tenantId = '33333333-3333-4333-8333-333333333333';
  const enforcedVerifier = new IdentitySignatureVerifier({
    key: SIGNING_KEY,
    enforced: true,
    maxSkewMs: 60_000,
  });
  let adapter: AlsTenantContextAdapter;
  let interceptor: TrustedIdentityInterceptor;

  beforeEach(() => {
    adapter = new AlsTenantContextAdapter();
    interceptor = new TrustedIdentityInterceptor(adapter, enforcedVerifier);
  });

  it('establishes tenant context when the identity carries a valid signature', async () => {
    const ts = Date.now();
    const identity = { tenantId, sub: 'user-9', roles: ['admin'] };
    const context = executionContextWith({
      [TENANT_ID_HEADER]: identity.tenantId,
      [USER_ID_HEADER]: identity.sub,
      [ROLES_HEADER]: identity.roles.join(','),
      [IDENTITY_TS_HEADER]: String(ts),
      [IDENTITY_SIG_HEADER]: signIdentity(SIGNING_KEY, identity, ts),
    });
    const next: CallHandler = {
      handle: () =>
        of({ tenantId: adapter.getTenantIdOrThrow(), roles: adapter.getContext()?.roles }),
    };

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({ tenantId, roles: ['admin'] });
  });

  it('rejects with 401 when the signature is missing', () => {
    const context = executionContextWith({
      [TENANT_ID_HEADER]: tenantId,
      [USER_ID_HEADER]: 'user-9',
    });
    const next: CallHandler = { handle: () => of(null) };

    expect(() => interceptor.intercept(context, next)).toThrow(UnauthorizedException);
  });

  it('rejects with 401 when the signature does not match the headers (forged/tampered)', () => {
    const ts = Date.now();
    const identity = { tenantId, sub: 'user-9', roles: [] };
    const context = executionContextWith({
      [TENANT_ID_HEADER]: identity.tenantId,
      [USER_ID_HEADER]: identity.sub,
      [IDENTITY_TS_HEADER]: String(ts),
      // Signed for a DIFFERENT tenant — simulates a direct-to-service caller
      // that forged x-tenant-id without knowing the signing key.
      [IDENTITY_SIG_HEADER]: signIdentity(SIGNING_KEY, { ...identity, tenantId: 'other' }, ts),
    });
    const next: CallHandler = { handle: () => of(null) };

    expect(() => interceptor.intercept(context, next)).toThrow(UnauthorizedException);
  });
});
