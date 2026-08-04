import type { SettingsCache } from './settings-cache';

/**
 * The `config.events` wire contract this library consumes. Duplicated (not
 * imported) from the config service's own `domain/config/config-event.ts` —
 * the two sides agree on the topic name + event types by convention, the same
 * pattern every other producer/consumer pair in this repo follows (e.g.
 * `order.events`), rather than a shared contracts package for three string
 * literals.
 */
export const CONFIG_EVENTS_TOPIC = 'config.events';
export const CONFIG_VALUE_CHANGED = 'ConfigValueChanged';
export const FEATURE_FLAG_CHANGED = 'FeatureFlagChanged';

/** `tenantId: null` means the GLOBAL default changed. */
export interface ConfigChangeMessage {
  tenantId: string | null;
  key: string;
}

/**
 * Pure cache-eviction rule for a decoded change message — factored out of the
 * Kafka wiring so it is unit-testable without a broker. A key is either a
 * value or a flag, never both, so evicting from both caches is a harmless
 * no-op for whichever one the key doesn't belong to.
 */
export function evictForConfigChange(
  message: ConfigChangeMessage,
  valueCache: SettingsCache<number>,
  flagCache: SettingsCache<boolean>,
): void {
  if (message.tenantId === null) {
    // The global default changed — no record of which cached tenant entries
    // were resolved via the fallback, so drop every tenant's copy of this key.
    valueCache.evictAllForKey(message.key);
    flagCache.evictAllForKey(message.key);
  } else {
    valueCache.evict(message.tenantId, message.key);
    flagCache.evict(message.tenantId, message.key);
  }
}
