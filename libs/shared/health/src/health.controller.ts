import { Controller, Get } from '@nestjs/common';

/**
 * Liveness/readiness probe for k8s. Trivial by design — it proves the Nest
 * HTTP listener is up and serving, not the health of downstream dependencies
 * (DB/broker readiness checks are a later hardening step). Mounted under each
 * importing service's own global prefix (`api/v1`), so it resolves at
 * `/api/v1/health` everywhere this module is imported.
 *
 * The gateway does NOT use this controller — it keeps its own
 * `HealthController` because it additionally needs the gateway-only
 * `@Public()`/`@SkipRateLimit()` decorators, which do not resolve outside the
 * gateway app.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
