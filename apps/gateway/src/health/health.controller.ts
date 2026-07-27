import { Public } from '@gateway/guards/public.decorator';
import { SkipRateLimit } from '@gateway/rate-limit/skip-rate-limit.decorator';
import { Controller, Get } from '@nestjs/common';

/**
 * Liveness probe for k8s/LB. `@Public()` skips JWT verification (probes carry no
 * token) and `@SkipRateLimit()` exempts it from the global limiter so frequent
 * probes never trip a 429 and flap the pod. Trivial by design — it proves the
 * process is up and serving, not the health of downstream dependencies. Served at
 * `/api/v1/health`, matching the gateway's `api` prefix + URI version.
 */
@Public()
@SkipRateLimit()
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
