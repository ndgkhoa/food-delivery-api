import { AccessTokenVerifier } from '@food-delivery-api/shared-auth';
import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

function extractBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const [scheme, token] = authorization.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/**
 * Verifies the `Authorization: Bearer` token via the shared offline JWKS
 * verifier and attaches the resulting identity to the request for the proxy
 * layer to propagate. Any missing/invalid/expired token → 401; the request
 * never reaches a downstream service unauthenticated.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly verifier: AccessTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      request.identity = await this.verifier.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
