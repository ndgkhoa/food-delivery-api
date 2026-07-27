import type { DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { z } from 'zod';
import { baseEnvSchema, validateEnv } from './env-schema';

/**
 * Thin wrapper around `@nestjs/config` that wires zod-based validation in.
 * Services pass their own extended schema (base env + service-specific vars);
 * defaults to the base schema if no service-specific vars are needed.
 */
export class SharedConfigModule {
  static forRoot<T extends z.ZodTypeAny = typeof baseEnvSchema>(
    schema: T = baseEnvSchema as unknown as T,
  ): DynamicModule | Promise<DynamicModule> {
    return ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // In tests the environment is injected directly into process.env (e.g. testcontainers
      // credentials), so skip the local `.env` file to avoid it overriding those values.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: (rawEnv: Record<string, unknown>): Record<string, unknown> =>
        validateEnv(schema, rawEnv) as Record<string, unknown>,
    });
  }
}
