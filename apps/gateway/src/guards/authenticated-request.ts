import type { VerifiedIdentity } from '@food-delivery-api/shared-jwt';
import type { Request } from 'express';

/** Express request after `JwtAuthGuard` has attached the verified identity. */
export interface AuthenticatedRequest extends Request {
  identity?: VerifiedIdentity;
}
