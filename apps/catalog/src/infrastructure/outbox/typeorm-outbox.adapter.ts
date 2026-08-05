import { randomUUID } from 'node:crypto';
import type { OutboxEntry, OutboxWriter } from '@catalog/domain/shared/outbox.port';
import { OutboxOrmEntity } from '@catalog/infrastructure/persistence/entities/outbox.orm-entity';
import { getTransactionalEntityManager } from '@catalog/infrastructure/persistence/transaction/transactional-entity-manager';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmOutboxAdapter implements OutboxWriter {
  constructor(
    @InjectRepository(OutboxOrmEntity)
    private readonly outboxRepository: Repository<OutboxOrmEntity>,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  private get repository(): Repository<OutboxOrmEntity> {
    return getTransactionalEntityManager()?.getRepository(OutboxOrmEntity) ?? this.outboxRepository;
  }

  async write(entry: OutboxEntry): Promise<void> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();

    const row = this.repository.create({
      aggregatetype: entry.aggregateType,
      aggregateid: entry.aggregateId,
      type: entry.type,
      payload: entry.payload,
      tenantId,
      correlationid: randomUUID(),
    });
    await this.repository.save(row);
  }
}
