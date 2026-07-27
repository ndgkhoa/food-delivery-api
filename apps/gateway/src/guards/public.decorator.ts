import { SetMetadata } from '@nestjs/common';

/** Reflector metadata key marking a route as exempt from `JwtAuthGuard`. */
export const IS_PUBLIC_KEY = 'gateway:isPublic';

/**
 * Marks a controller/route as PUBLIC so the globally-registered `JwtAuthGuard`
 * lets it through unauthenticated. Used for the session endpoints that establish
 * or rotate a session (they cannot require a token to obtain one). Public routes
 * are still IP-rate-limited by the global `RateLimitGuard`.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
