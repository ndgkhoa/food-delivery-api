import type { AuditAction } from '@catalog/domain/shared/audit-action';

export interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface AuditPort {
  record(entry: AuditEntry): Promise<void>;
}

export const AUDIT_PORT = Symbol('AuditPort');
