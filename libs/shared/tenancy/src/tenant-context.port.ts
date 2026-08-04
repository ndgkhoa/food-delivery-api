export interface TenantRequestContext {
  tenantId: string;
  actor: string;
  roles: string[];
}

export interface TenantContextPort {
  run<T>(context: TenantRequestContext, callback: () => T): T;
  getContext(): TenantRequestContext | undefined;
  getTenantIdOrThrow(): string;
  getActor(): string;
}

export const TENANT_CONTEXT_PORT = Symbol('TenantContextPort');
