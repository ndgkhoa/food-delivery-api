import { DomainException } from '@food-delivery-api/shared-errors';

/**
 * Domain-layer errors, framework-free (beyond the `DomainException` base) so
 * use cases stay transport-agnostic — the shared `GlobalExceptionFilter`
 * reads `code`/`httpStatus` directly off each: not-found → 404, insufficient
 * role → 403.
 */

/** No tenant override AND no global default exist for this key. */
export class ConfigEntryNotFoundError extends DomainException {
  readonly code = 'CONFIG_ENTRY_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly key: string) {
    super(`No config value set for key "${key}"`);
  }
}

/** No tenant override AND no global default exist for this flag key. */
export class FeatureFlagNotFoundError extends DomainException {
  readonly code = 'CONFIG_FEATURE_FLAG_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly key: string) {
    super(`No feature flag set for key "${key}"`);
  }
}

/** A caller without the `platform-admin` role attempted to write the GLOBAL default. */
export class GlobalWriteRequiresPlatformAdminError extends DomainException {
  readonly code = 'CONFIG_GLOBAL_WRITE_FORBIDDEN';
  readonly httpStatus = 403;

  constructor() {
    super('Writing the global default requires the platform-admin role');
  }
}
