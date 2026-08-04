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
