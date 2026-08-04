import { buildCacheKey, SettingsCache } from './settings-cache';
import type { SettingsClientLogger } from './settings-client-logger';

export interface SettingsClientOptions {
  configServiceUrl: string;
  ttlMs: number;
}

const FETCH_TIMEOUT_MS = 3_000;
const SYSTEM_ACTOR = 'settings-client';

type ConfigResponse = { status: 404 } | { status: 200; body: unknown };

async function requestJsonWithTimeout(
  url: string,
  headers: Record<string, string>,
): Promise<ConfigResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (res.status === 404) {
      return { status: 404 };
    }
    if (!res.ok) {
      throw new Error(`config service returned ${res.status}`);
    }
    return { status: 200, body: await res.json() };
  } finally {
    clearTimeout(timer);
  }
}

function identityHeaders(tenantId: string): Record<string, string> {
  return { 'x-tenant-id': tenantId, 'x-user-id': SYSTEM_ACTOR, 'x-roles': '' };
}

export class SettingsClient {
  constructor(
    private readonly options: SettingsClientOptions,
    private readonly valueCache: SettingsCache<number>,
    private readonly flagCache: SettingsCache<boolean>,
    private readonly logger: SettingsClientLogger,
  ) {}

  async getInt(key: string, tenantId: string, defaultValue: number): Promise<number> {
    const cacheKey = buildCacheKey(tenantId, key);
    const cached = this.valueCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const value = await this.fetchValue(key, tenantId);
      if (value === undefined) {
        return defaultValue;
      }
      this.valueCache.set(cacheKey, value, this.options.ttlMs);
      return value;
    } catch (error) {
      this.logger.warn(
        `config service unreachable for "${key}" — using caller default ${defaultValue}: ${describeError(error)}`,
      );
      return defaultValue;
    }
  }

  async isEnabled(key: string, tenantId: string, defaultValue: boolean): Promise<boolean> {
    const cacheKey = buildCacheKey(tenantId, key);
    const cached = this.flagCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const enabled = await this.fetchFlag(key, tenantId);
      if (enabled === undefined) {
        return defaultValue;
      }
      this.flagCache.set(cacheKey, enabled, this.options.ttlMs);
      return enabled;
    } catch (error) {
      this.logger.warn(
        `config service unreachable for flag "${key}" — using caller default ${defaultValue}: ${describeError(error)}`,
      );
      return defaultValue;
    }
  }

  private async fetchValue(key: string, tenantId: string): Promise<number | undefined> {
    const res = await requestJsonWithTimeout(
      `${this.baseUrl()}/config/${encodeURIComponent(key)}`,
      identityHeaders(tenantId),
    );
    if (res.status === 404) {
      return undefined;
    }
    const value = (res.body as { value?: unknown }).value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`config service returned a non-numeric value for "${key}"`);
    }
    return value;
  }

  private async fetchFlag(key: string, tenantId: string): Promise<boolean | undefined> {
    const res = await requestJsonWithTimeout(
      `${this.baseUrl()}/config/flags/${encodeURIComponent(key)}`,
      identityHeaders(tenantId),
    );
    if (res.status === 404) {
      return undefined;
    }
    const enabled = (res.body as { enabled?: unknown }).enabled;
    if (typeof enabled !== 'boolean') {
      throw new Error(`config service returned a non-boolean flag for "${key}"`);
    }
    return enabled;
  }

  private baseUrl(): string {
    return `${this.options.configServiceUrl.replace(/\/$/, '')}/api/v1`;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
