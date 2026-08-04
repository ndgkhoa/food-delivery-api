/**
 * Minimal logger shape so this lib never hard-depends on `@nestjs/common`'s
 * `Logger` class — the module wiring passes a real Nest `Logger` in, but a
 * plain object (or a test double) satisfies this just as well. Mirrors
 * `SettingsClientLogger` in `@food-delivery-api/shared-settings`.
 */
export interface CacheLogger {
  warn(message: string): void;
}
