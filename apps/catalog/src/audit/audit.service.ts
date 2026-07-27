import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { AuditAction } from './audit-action.enum';
import { AuditLog } from './audit-log.entity';

export interface RecordAuditEntryParams {
  action: AuditAction;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Writes one immutable row per create/update/delete. Tenant + actor are read
 * from the request-scoped `TenantContextService` rather than passed in by
 * callers, so no write path can accidentally omit or spoof them.
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly auditLogRepository: Repository<AuditLog>,
    private readonly tenantContext: TenantContextService,
  ) {}

  async record(params: RecordAuditEntryParams): Promise<void> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const actor = this.tenantContext.getActor();

    const entry = this.auditLogRepository.create({
      tenantId,
      actor,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      // Entity instances (e.g. Restaurant) are structurally compatible with a plain JSON object at runtime.
      before: (params.before as Record<string, unknown> | undefined) ?? null,
      after: (params.after as Record<string, unknown> | undefined) ?? null,
    });
    await this.auditLogRepository.save(entry);
  }
}
