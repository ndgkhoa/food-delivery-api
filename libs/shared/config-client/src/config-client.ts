import { buildCacheKey, ConfigCache } from './config-cache';
import type { ConfigClientLogger } from './config-client-logger';

export interface ConfigClientOptions {
  /** Base URL of the config service, e.g. `http://localhost:3008`. */
  configServiceUrl: string;
  /** How long a resolved value/flag is cached before a background re-fetch. */
  ttlMs: number;
}

const FETCH_TIMEOUT_MS = 3_000;
/** Identity this internal caller stamps on its own request — config-client IS the trust boundary for this one hop, the same way a gRPC caller establishes tenant scope from call metadata rather than an HTTP header. */
const SYSTEM_ACTOR = 'config-client';

/** A JSON body absent because the key isn't configured (404) vs a parsed body. */
type ConfigResponse = { status: 404 } | { status: 200; body: unknown };

/**
 * Fetches AND reads the JSON body under ONE abort timeout. `fetch` resolves as
 * soon as response headers arrive, so reading the body outside this region
 * would leave `res.json()` un-timed — a stalled body would hang `getInt`/
 * `isEnabled` forever and turn config into the hard dependency it must never be.
 * 404 (key not configured) is a normal "absent" signal, not a failure.
 */
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

/**
 * Read-through cache in front of the config service's HTTP API. `getInt`/
 * `isEnabled` NEVER throw: a cold cache miss with the config service
 * unreachable (or erroring) logs a WARN and returns the caller-supplied
 * default — config must never be a hard dependency for a business flow like
 * placing an order. A resolved-but-absent key (404 — no tenant or global row
 * configured) is a normal state, not a failure, so it falls back to the
 * default silently (no WARN).
 */
export class ConfigClient {
  constructor(
    private readonly options: ConfigClientOptions,
    private readonly valueCache: ConfigCache<number>,
    private readonly flagCache: ConfigCache<boolean>,
    private readonly logger: ConfigClientLogger,
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
      // A well-formed-looking 200 with a non-numeric value is corrupt, not a
      // real config — throw so getInt WARNs + falls back rather than caching junk.
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
