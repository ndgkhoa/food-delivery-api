export interface TenantRequestContext {
  /** Tenant scope for the request — sourced from the verified `tenant_id` token claim. */
  tenantId: string;
  /** Identity of the caller — the verified token subject (`sub`); `system`/`anonymous` outside a request. */
  actor: string;
}

/**
 * Propagates the current request's tenant + actor through the async call
 * chain, so use cases and adapters deep in the stack (e.g. the audit
 * adapter) can enforce tenant scoping without every method signature
 * threading a `tenantId` parameter through.
 *
 * Framework-agnostic on purpose (no `@nestjs/*` imports) so it can back a
 * service's domain/application layers without coupling them to a framework.
 */
export interface TenantContextPort {
  run<T>(context: TenantRequestContext, callback: () => T): T;
  getContext(): TenantRequestContext | undefined;
  /** Throws if called outside a request scope — fails closed, never silently unscoped. */
  getTenantIdOrThrow(): string;
  getActor(): string;
}

export const TENANT_CONTEXT_PORT = Symbol('TenantContextPort');
