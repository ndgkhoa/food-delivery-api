import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_HEADER, USER_ID_HEADER } from './identity-headers';
import { REQUIRED_ROLES_METADATA, Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

function contextWith(headers: Record<string, string>, requiredRoles?: string[]): ExecutionContext {
  const handler = () => undefined;
  if (requiredRoles) {
    Reflect.defineMetadata(REQUIRED_ROLES_METADATA, requiredRoles, handler);
  }
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;

  beforeEach(() => {
    guard = new RolesGuard(new Reflector());
  });

  it('allows a route with no @Roles metadata (open to any authenticated tenant)', () => {
    const context = contextWith({});
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows when the identity carries one of the required roles', () => {
    const context = contextWith(
      { [USER_ID_HEADER]: 'user-1', [ROLES_HEADER]: 'customer,restaurant-owner' },
      ['restaurant-owner', 'admin'],
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('returns 403 when a verified identity lacks every required role', () => {
    const context = contextWith({ [USER_ID_HEADER]: 'user-1', [ROLES_HEADER]: 'customer' }, [
      'restaurant-owner',
      'admin',
    ]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('returns 401 when no verified identity reached the service', () => {
    // Role required, but no gateway-stamped subject header → unauthenticated.
    const context = contextWith({ [ROLES_HEADER]: 'restaurant-owner' }, ['restaurant-owner']);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('exposes the required roles via the @Roles decorator metadata', () => {
    class SampleController {
      @Roles('admin')
      write() {}
    }
    const roles = Reflect.getMetadata(REQUIRED_ROLES_METADATA, SampleController.prototype.write);
    expect(roles).toEqual(['admin']);
  });
});
