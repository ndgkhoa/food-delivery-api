import { DomainException } from '@food-delivery-api/shared-errors';

export class ConfigEntryNotFoundError extends DomainException {
  readonly code = 'CONFIG_ENTRY_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly key: string) {
    super(`No config value set for key "${key}"`);
  }
}

export class FeatureFlagNotFoundError extends DomainException {
  readonly code = 'CONFIG_FEATURE_FLAG_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly key: string) {
    super(`No feature flag set for key "${key}"`);
  }
}

export class GlobalWriteRequiresPlatformAdminError extends DomainException {
  readonly code = 'CONFIG_GLOBAL_WRITE_FORBIDDEN';
  readonly httpStatus = 403;

  constructor() {
    super('Writing the global default requires the platform-admin role');
  }
}
