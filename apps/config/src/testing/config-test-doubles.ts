import type { ConfigEntry } from '@config/domain/config/config-entry';
import type { ConfigEntryRepository } from '@config/domain/config/config-entry.repository';
import type {
  ConfigChangePayload,
  ConfigEventPublisherPort,
} from '@config/domain/config/config-event';
import type { FeatureFlag } from '@config/domain/config/feature-flag';
import type { FeatureFlagRepository } from '@config/domain/config/feature-flag.repository';
import type { TenantContextPort, TenantRequestContext } from '@food-delivery-api/shared-tenancy';

export class FakeConfigEntryRepository implements ConfigEntryRepository {
  readonly rows = new Map<string, ConfigEntry>();

  private rowKey(tenantId: string | null, key: string): string {
    return `${tenantId ?? 'GLOBAL'}:${key}`;
  }

  async findTenantEntry(tenantId: string, key: string): Promise<ConfigEntry | null> {
    return this.rows.get(this.rowKey(tenantId, key)) ?? null;
  }

  async findGlobalEntry(key: string): Promise<ConfigEntry | null> {
    return this.rows.get(this.rowKey(null, key)) ?? null;
  }

  async findAllForTenant(tenantId: string): Promise<ConfigEntry[]> {
    return [...this.rows.values()].filter(
      (entry) => entry.tenantId === tenantId || entry.tenantId === null,
    );
  }

  async upsert(entry: ConfigEntry): Promise<ConfigEntry> {
    this.rows.set(this.rowKey(entry.tenantId, entry.key), entry);
    return entry;
  }
}

export class FakeFeatureFlagRepository implements FeatureFlagRepository {
  readonly rows = new Map<string, FeatureFlag>();

  private rowKey(tenantId: string | null, key: string): string {
    return `${tenantId ?? 'GLOBAL'}:${key}`;
  }

  async findTenantFlag(tenantId: string, key: string): Promise<FeatureFlag | null> {
    return this.rows.get(this.rowKey(tenantId, key)) ?? null;
  }

  async findGlobalFlag(key: string): Promise<FeatureFlag | null> {
    return this.rows.get(this.rowKey(null, key)) ?? null;
  }

  async upsert(flag: FeatureFlag): Promise<FeatureFlag> {
    this.rows.set(this.rowKey(flag.tenantId, flag.key), flag);
    return flag;
  }
}

export class FakeConfigEventPublisher implements ConfigEventPublisherPort {
  readonly valueChanges: ConfigChangePayload[] = [];
  readonly flagChanges: ConfigChangePayload[] = [];

  async publishValueChanged(payload: ConfigChangePayload): Promise<void> {
    this.valueChanges.push(payload);
  }

  async publishFlagChanged(payload: ConfigChangePayload): Promise<void> {
    this.flagChanges.push(payload);
  }
}

export class FakeTenantContext implements TenantContextPort {
  constructor(private context: TenantRequestContext) {}

  run<T>(context: TenantRequestContext, callback: () => T): T {
    this.context = context;
    return callback();
  }

  getContext(): TenantRequestContext | undefined {
    return this.context;
  }

  getTenantIdOrThrow(): string {
    return this.context.tenantId;
  }

  getActor(): string {
    return this.context.actor;
  }

  setRoles(roles: string[]): void {
    this.context = { ...this.context, roles };
  }
}
