export interface ConfigEntryProps {
  id: string;
  /** `null` = the GLOBAL default; a tenant row overrides it. */
  tenantId: string | null;
  key: string;
  value: number;
  updatedAt: Date;
}

export interface CreateConfigEntryProps {
  id: string;
  tenantId: string | null;
  key: string;
  value: number;
}

const MAX_KEY_LENGTH = 255;
const MIN_VALUE = 0;
const MAX_VALUE = Number.MAX_SAFE_INTEGER;

function assertValidKey(key: string): void {
  if (!key.trim()) {
    throw new Error('Config key is required');
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new Error(`Config key must be at most ${MAX_KEY_LENGTH} characters`);
  }
}

/** Config values are integers (cents / basis-points) — a jsonb value is YAGNI while every tunable is a plain number. */
function assertValidValue(value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error('Config value must be an integer');
  }
  if (value < MIN_VALUE || value > MAX_VALUE) {
    throw new Error(`Config value must be between ${MIN_VALUE} and ${MAX_VALUE}`);
  }
}

/**
 * Plain-class aggregate for one config row — no framework/ORM dependency.
 * Constructed only via `create()` (a brand-new row) or `reconstitute()`
 * (rehydrated from persistence). `withValue` returns a new immutable instance
 * so a caller never mutates a shared reference.
 */
export class ConfigEntry {
  private constructor(private readonly props: ConfigEntryProps) {}

  static create(props: CreateConfigEntryProps): ConfigEntry {
    const key = props.key.trim();
    assertValidKey(key);
    assertValidValue(props.value);
    return new ConfigEntry({ ...props, key, updatedAt: new Date() });
  }

  static reconstitute(props: ConfigEntryProps): ConfigEntry {
    return new ConfigEntry(props);
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

  get value(): number {
    return this.props.value;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** Returns a new instance with the value replaced — id/tenantId/key never change once created. */
  withValue(value: number): ConfigEntry {
    assertValidValue(value);
    return new ConfigEntry({ ...this.props, value, updatedAt: new Date() });
  }
}
