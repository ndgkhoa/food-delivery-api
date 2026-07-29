/**
 * Domain-layer errors, framework-free so use cases stay transport-agnostic —
 * the interface layer maps each to an HTTP status (see the config exception
 * filter): not-found → 404, insufficient role → 403.
 */

/** No tenant override AND no global default exist for this key. */
export class ConfigEntryNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`No config value set for key "${key}"`);
    this.name = 'ConfigEntryNotFoundError';
  }
}

/** No tenant override AND no global default exist for this flag key. */
export class FeatureFlagNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`No feature flag set for key "${key}"`);
    this.name = 'FeatureFlagNotFoundError';
  }
}

/** A caller without the `platform-admin` role attempted to write the GLOBAL default. */
export class GlobalWriteRequiresPlatformAdminError extends Error {
  constructor() {
    super('Writing the global default requires the platform-admin role');
    this.name = 'GlobalWriteRequiresPlatformAdminError';
  }
}
