import type { SettingsCache } from './settings-cache';

export const CONFIG_EVENTS_TOPIC = 'config.events';
export const CONFIG_VALUE_CHANGED = 'ConfigValueChanged';
export const FEATURE_FLAG_CHANGED = 'FeatureFlagChanged';

export interface ConfigChangeMessage {
  tenantId: string | null;
  key: string;
}

export function evictForConfigChange(
  message: ConfigChangeMessage,
  valueCache: SettingsCache<number>,
  flagCache: SettingsCache<boolean>,
): void {
  if (message.tenantId === null) {
    valueCache.evictAllForKey(message.key);
    flagCache.evictAllForKey(message.key);
  } else {
    valueCache.evict(message.tenantId, message.key);
    flagCache.evict(message.tenantId, message.key);
  }
}
