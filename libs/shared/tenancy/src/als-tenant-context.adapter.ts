import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { TenantContextPort, TenantRequestContext } from './tenant-context.port';

const storage = new AsyncLocalStorage<TenantRequestContext>();

class TenantContextNotSetError extends Error {
  constructor() {
    super(
      'Tenant context is not set — ensure the trusted-identity interceptor runs before this code path',
    );
    this.name = 'TenantContextNotSetError';
  }
}

/** Async-local-storage adapter for `TenantContextPort` — set once per request by the trusted-identity interceptor. */
@Injectable()
export class AlsTenantContextAdapter implements TenantContextPort {
  run<T>(context: TenantRequestContext, callback: () => T): T {
    return storage.run(context, callback);
  }

  getContext(): TenantRequestContext | undefined {
    return storage.getStore();
  }

  getTenantIdOrThrow(): string {
    const context = this.getContext();
    if (!context) {
      throw new TenantContextNotSetError();
    }
    return context.tenantId;
  }

  getActor(): string {
    return this.getContext()?.actor ?? 'system';
  }
}
