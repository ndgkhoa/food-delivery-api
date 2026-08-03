import { randomUUID } from 'node:crypto';
import type { OutboxEntry, OutboxWriter } from '@catalog/domain/shared/outbox.port';
import { OutboxOrmEntity } from '@catalog/infrastructure/persistence/entities/outbox.orm-entity';
import { getTransactionalEntityManager } from '@catalog/infrastructure/persistence/transaction/transactional-entity-manager';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

/**
 * Appends one outbox row per write. Tenant is read from the tenant context
 * (never from the entry) so no call site can spoof it — the same invariant the
 * audit writer enforces. A fresh `correlationid` is minted per event: request
 * correlation isn't propagated into the service layer yet, and the column must
 * be non-null so the routed message always carries an `x-correlation-id`
 * header the consumer's fail-closed decoder requires.
 */
@Injectable()
export class TypeOrmOutboxAdapter implements OutboxWriter {
  constructor(
    @InjectRepository(OutboxOrmEntity)
    private readonly outboxRepository: Repository<OutboxOrmEntity>,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  /** Enlists in the active transaction so the outbox row commits atomically with its write. */
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
