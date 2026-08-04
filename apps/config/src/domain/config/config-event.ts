export interface ConfigChangePayload {
  tenantId: string | null;
  key: string;
}

export const CONFIG_VALUE_CHANGED = 'ConfigValueChanged';
export const FEATURE_FLAG_CHANGED = 'FeatureFlagChanged';

export interface ConfigEventPublisherPort {
  publishValueChanged(payload: ConfigChangePayload): Promise<void>;
  publishFlagChanged(payload: ConfigChangePayload): Promise<void>;
}

export const CONFIG_EVENT_PUBLISHER = Symbol('ConfigEventPublisherPort');
