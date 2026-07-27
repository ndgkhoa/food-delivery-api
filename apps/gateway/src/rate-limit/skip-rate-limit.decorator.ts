import { SetMetadata } from '@nestjs/common';

/** Reflector metadata key marking a route as exempt from `RateLimitGuard`. */
export const SKIP_RATE_LIMIT_KEY = 'gateway:skipRateLimit';

/**
 * Marks a controller/route as exempt from the global `RateLimitGuard`. Used for
 * liveness/health probes that k8s/LB hit at high frequency — throttling them
 * would trip a 429 and mark the pod unhealthy for a purely operational call.
 */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RATE_LIMIT_KEY, true);
