import { AccessTokenVerifier } from '@food-delivery-api/shared-jwt';
import {
  createTestKeySet,
  TEST_TENANT_ID,
  type TestKeySet,
} from '@food-delivery-api/shared-jwt/testing';
import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { JwtAuthGuard } from '@gateway/guards/jwt-auth.guard';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

const ISSUER = 'https://idp.test/realms/food-delivery';
const AUDIENCE = 'food-delivery-api';

function contextForRequest(request: Partial<AuthenticatedRequest>): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const req = { headers: {}, ...request } as AuthenticatedRequest;
  const handlerRef = (): void => undefined;
  class ClassRef {}
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handlerRef,
    getClass: () => ClassRef,
  } as unknown as ExecutionContext;
  return { context, request: req };
}

describe('JwtAuthGuard', () => {
  let keys: TestKeySet;
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeAll(async () => {
    keys = await createTestKeySet({ issuer: ISSUER, audience: AUDIENCE });
    const verifier = new AccessTokenVerifier(keys.keyResolver, {
      jwksUri: 'unused-in-test',
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    reflector = new Reflector();
    guard = new JwtAuthGuard(verifier, reflector);
  });

  it('lets a @Public() route through without a token', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true);
    const { context } = contextForRequest({ headers: {} });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('passes and attaches the verified identity for a valid token', async () => {
    const token = await keys.sign({ sub: 'owner-1', roles: ['restaurant-owner'] });
    const { context, request } = contextForRequest({
      headers: { authorization: `Bearer ${token}` },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.identity).toEqual({
      sub: 'owner-1',
      tenantId: TEST_TENANT_ID,
      roles: ['restaurant-owner'],
    });
  });

  it('rejects a request with no Authorization header', async () => {
    const { context } = contextForRequest({ headers: {} });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a malformed (non-bearer) Authorization header', async () => {
    const { context } = contextForRequest({ headers: { authorization: 'Basic abc123' } });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an invalid/expired token', async () => {
    const token = await keys.sign({ expiresInSec: -60 });
    const { context } = contextForRequest({ headers: { authorization: `Bearer ${token}` } });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
