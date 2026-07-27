import { z } from 'zod';

/**
 * 12-factor env schema shared by every Nest service in the monorepo.
 * Each service extends this with its own required vars (e.g. DB name)
 * rather than redefining the common ones — keeps env validation DRY.
 */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_USERNAME: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

/**
 * Validates raw `process.env` against a zod schema and fails fast with a
 * readable error instead of letting the app boot with missing/invalid config.
 * Used as the `validate` hook for `@nestjs/config`'s `ConfigModule.forRoot`.
 */
export function validateEnv<T extends z.ZodTypeAny>(
  schema: T,
  rawEnv: Record<string, unknown>,
): z.infer<T> {
  const result = schema.safeParse(rawEnv);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
