import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  firstHeaderValue,
  parseRolesHeader,
  ROLES_HEADER,
  USER_ID_HEADER,
} from './identity-headers';
import { REQUIRED_ROLES_METADATA } from './roles.decorator';

/**
 * Enforces RBAC at the service, using the roles the gateway verified and
 * stamped onto trusted headers. Runs before the trusted-identity interceptor,
 * so it reads the `x-roles`/`x-user-id` headers directly rather than the
 * request-scoped tenant context (which is not established until the interceptor).
 *
 * - No `@Roles` metadata → route open to any authenticated tenant (the
 *   trusted-identity interceptor still enforces a verified tenant on reads).
 * - `@Roles` present but no verified identity reached the service → 401.
 * - Verified identity lacks every required role → 403.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRED_ROLES_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    // A stamped subject header is the signal that a verified identity reached
    // the service; its absence means no authenticated caller → 401, not 403.
    if (!firstHeaderValue(request.headers[USER_ID_HEADER])) {
      throw new UnauthorizedException('Missing verified identity');
    }

    const roles = parseRolesHeader(firstHeaderValue(request.headers[ROLES_HEADER]));
    if (!required.some((role) => roles.includes(role))) {
      throw new ForbiddenException('Insufficient role for this operation');
    }
    return true;
  }
}
