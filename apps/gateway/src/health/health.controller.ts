import { Public } from '@gateway/guards/public.decorator';
import { SkipRateLimit } from '@gateway/rate-limit/skip-rate-limit.decorator';
import { Controller, Get } from '@nestjs/common';

@Public()
@SkipRateLimit()
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
