import type { VerifiedIdentity } from '@food-delivery-api/shared-jwt';
import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  identity?: VerifiedIdentity;
}
