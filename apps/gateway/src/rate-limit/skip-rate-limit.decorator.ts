import { SetMetadata } from '@nestjs/common';

export const SKIP_RATE_LIMIT_KEY = 'gateway:skipRateLimit';

export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RATE_LIMIT_KEY, true);
