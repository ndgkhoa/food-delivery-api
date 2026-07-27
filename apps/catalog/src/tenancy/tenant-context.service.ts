import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface TenantRequestContext {
  tenantId: string;
  /** DEV-ONLY: identity of the caller, sourced from `x-actor-id`; replaced by the JWT subject once auth ships. */
  actor: string;
}

const storage = new AsyncLocalStorage<TenantRequestContext>();

/**
 * Propagates the current request's tenant + actor through the async call
 * chain (set once by `TenantContextInterceptor`), so repositories/services
 * deep in the stack (e.g. `AuditService`) can enforce tenant scoping without
 * every method signature threading a `tenantId` parameter through.
 */
@Injectable()
export class TenantContextService {
  run<T>(context: TenantRequestContext, callback: () => T): T {
    return storage.run(context, callback);
  }

  getContext(): TenantRequestContext | undefined {
    return storage.getStore();
  }

  /** Throws if called outside a request handled by `TenantContextInterceptor` — fails closed, never silently unscoped. */
  getTenantIdOrThrow(): string {
    const context = this.getContext();
    if (!context) {
      throw new Error(
        'Tenant context is not set — ensure TenantContextInterceptor runs before this code path',
      );
    }
    return context.tenantId;
  }

  getActor(): string {
    return this.getContext()?.actor ?? 'system';
  }
}
