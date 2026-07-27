export interface TenantRequestContext {
  tenantId: string;
  /** DEV-ONLY: identity of the caller, sourced from `x-actor-id`; replaced by the JWT subject once auth ships. */
  actor: string;
}

/**
 * Propagates the current request's tenant + actor through the async call
 * chain, so use cases and adapters deep in the stack (e.g. the audit
 * adapter) can enforce tenant scoping without every method signature
 * threading a `tenantId` parameter through.
 */
export interface TenantContextPort {
  run<T>(context: TenantRequestContext, callback: () => T): T;
  getContext(): TenantRequestContext | undefined;
  /** Throws if called outside a request scope — fails closed, never silently unscoped. */
  getTenantIdOrThrow(): string;
  getActor(): string;
}

export const TENANT_CONTEXT_PORT = Symbol('TenantContextPort');
