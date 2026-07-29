/**
 * Change-event payload every write publishes to `config.events`. Carries only
 * identity (tenant scope + key), never the value — a consumer re-fetches the
 * resolved value over the authenticated internal path rather than trusting a
 * business value placed on the wire.
 */
export interface ConfigChangePayload {
  tenantId: string | null;
  key: string;
}

export const CONFIG_VALUE_CHANGED = 'ConfigValueChanged';
export const FEATURE_FLAG_CHANGED = 'FeatureFlagChanged';

/** Port a write use case publishes through — never the Kafka producer directly. */
export interface ConfigEventPublisherPort {
  publishValueChanged(payload: ConfigChangePayload): Promise<void>;
  publishFlagChanged(payload: ConfigChangePayload): Promise<void>;
}

export const CONFIG_EVENT_PUBLISHER = Symbol('ConfigEventPublisherPort');
