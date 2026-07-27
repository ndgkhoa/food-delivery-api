import type { AuditEntry, AuditPort } from '@catalog/domain/shared/audit.port';
import {
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
} from '@catalog/domain/shared/tenant-context.port';
import { AuditLogOrmEntity } from '@catalog/infrastructure/persistence/entities/audit-log.orm-entity';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

/**
 * Writes one immutable row per create/update/delete. Tenant + actor are read
 * from the tenant context port rather than passed in by callers, so no write
 * path can accidentally omit or spoof them.
 */
@Injectable()
export class TypeOrmAuditAdapter implements AuditPort {
  constructor(
    @InjectRepository(AuditLogOrmEntity)
    private readonly auditLogRepository: Repository<AuditLogOrmEntity>,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const actor = this.tenantContext.getActor();

    const record = this.auditLogRepository.create({
      tenantId,
      actor,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
    await this.auditLogRepository.save(record);
  }
}
