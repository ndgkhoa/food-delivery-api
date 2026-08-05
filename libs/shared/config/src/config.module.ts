import type { DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { z } from 'zod';
import { baseEnvSchema, validateEnv } from './env-schema';

export class SharedConfigModule {
  static forRoot<T extends z.ZodTypeAny = typeof baseEnvSchema>(
    schema: T = baseEnvSchema as unknown as T,
  ): DynamicModule | Promise<DynamicModule> {
    return ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: (rawEnv: Record<string, unknown>): Record<string, unknown> =>
        validateEnv(schema, rawEnv) as Record<string, unknown>,
    });
  }
}
