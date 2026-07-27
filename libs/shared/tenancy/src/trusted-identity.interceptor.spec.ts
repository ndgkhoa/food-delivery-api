import { type CallHandler, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { AlsTenantContextAdapter } from './als-tenant-context.adapter';
import { ROLES_HEADER, TENANT_ID_HEADER, USER_ID_HEADER } from './identity-headers';
import { TrustedIdentityInterceptor } from './trusted-identity.interceptor';

function executionContextWith(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('TrustedIdentityInterceptor', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222';
  let adapter: AlsTenantContextAdapter;
  let interceptor: TrustedIdentityInterceptor;

  beforeEach(() => {
    adapter = new AlsTenantContextAdapter();
    interceptor = new TrustedIdentityInterceptor(adapter);
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
});
