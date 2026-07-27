import type { AuditAction } from '@catalog/domain/shared/audit-action';

export interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Writes one immutable row per create/update/delete. Adapters read the
 * acting tenant/actor from the tenant context port rather than accepting
 * them as parameters, so no call site can accidentally omit or spoof them.
 */
export interface AuditPort {
  record(entry: AuditEntry): Promise<void>;
}

export const AUDIT_PORT = Symbol('AuditPort');
