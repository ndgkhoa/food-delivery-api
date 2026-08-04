import type { AuditEntry, AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditLogOrmEntity } from '@catalog/infrastructure/persistence/entities/audit-log.orm-entity';
import { getTransactionalEntityManager } from '@catalog/infrastructure/persistence/transaction/transactional-entity-manager';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmAuditAdapter implements AuditPort {
  constructor(
    @InjectRepository(AuditLogOrmEntity)
    private readonly auditLogRepository: Repository<AuditLogOrmEntity>,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  private get repository(): Repository<AuditLogOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(AuditLogOrmEntity) ?? this.auditLogRepository
    );
  }

  async record(entry: AuditEntry): Promise<void> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const actor = this.tenantContext.getActor();

    const record = this.repository.create({
      tenantId,
      actor,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
    await this.repository.save(record);
  }
}
