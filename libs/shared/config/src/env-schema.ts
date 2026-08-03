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
  // Documents the OTel contract every service shares; `register.ts` reads these
  // straight off `process.env` (it starts before `ConfigModule` even exists),
  // so these defaults are duplicated there — kept in sync by inspection, not
  // by import, since the register module cannot depend on a validated config
  // that isn't built yet when it runs.
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().min(1).default('http://localhost:4318'),
  // A `'true' | 'false'` string, NOT `z.coerce.boolean()`: JS's `Boolean('false')`
  // is `true`, which would silently invert an explicit opt-out — `register.ts`
  // itself does a plain `=== 'false'` string check for the same reason.
  TELEMETRY_ENABLED: z.enum(['true', 'false']).default('true'),
  // Shared HMAC secret the gateway signs the trusted identity headers with and
  // every service verifies them against — NOT `.min(1)`-required: unset means
  // "unsigned/unenforced", which keeps local one-off runs (no key exported)
  // working. `TenancyModule`'s verifier factory reads this straight off
  // `process.env` (same "no validated schema at the point it's read" rationale
  // as `OTEL_EXPORTER_OTLP_ENDPOINT` above), so this entry documents the
  // contract rather than being consumed via `ConfigService` in shared-tenancy.
  INTERNAL_IDENTITY_SIGNING_KEY: z.string().min(32).optional(),
  // Replay window (ms) for the signed identity's `x-identity-ts`; tolerates
  // k8s clock skew across pods without opening a large forgery window.
  INTERNAL_IDENTITY_MAX_SKEW_MS: z.coerce.number().int().positive().default(60000),
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
