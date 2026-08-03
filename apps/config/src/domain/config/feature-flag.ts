export interface FeatureFlagProps {
  id: string;
  /** `null` = the GLOBAL default; a tenant row overrides it. */
  tenantId: string | null;
  key: string;
  enabled: boolean;
  updatedAt: Date;
}

export interface CreateFeatureFlagProps {
  id: string;
  tenantId: string | null;
  key: string;
  enabled: boolean;
}

const MAX_KEY_LENGTH = 255;

function assertValidKey(key: string): void {
  if (!key.trim()) {
    throw new Error('Feature flag key is required');
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new Error(`Feature flag key must be at most ${MAX_KEY_LENGTH} characters`);
  }
}

/**
 * Plain-class aggregate for one feature-flag row — separate from `ConfigEntry`
 * on purpose (flags are boolean switches, never business-tunable numbers; the
 * two concerns are never conflated — separate tables, separate API paths).
 * Constructed only via `create()` or `reconstitute()`.
 */
export class FeatureFlag {
  private constructor(private readonly props: FeatureFlagProps) {}

  static create(props: CreateFeatureFlagProps): FeatureFlag {
    const key = props.key.trim();
    assertValidKey(key);
    return new FeatureFlag({ ...props, key, updatedAt: new Date() });
  }

  static reconstitute(props: FeatureFlagProps): FeatureFlag {
    return new FeatureFlag(props);
  }

  get id(): string {
    return this.props.id;
  }

  get tenantId(): string | null {
    return this.props.tenantId;
  }

  get key(): string {
    return this.props.key;
  }

  get enabled(): boolean {
    return this.props.enabled;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** Returns a new instance with `enabled` replaced — id/tenantId/key never change once created. */
  withEnabled(enabled: boolean): FeatureFlag {
    return new FeatureFlag({ ...this.props, enabled, updatedAt: new Date() });
  }
}
