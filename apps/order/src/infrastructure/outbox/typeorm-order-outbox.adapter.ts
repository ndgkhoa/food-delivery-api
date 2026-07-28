import { randomUUID } from 'node:crypto';
import {
  encodeHeaders,
  type OutboxPort,
  type OutboxRecord,
} from '@food-delivery-api/shared-messaging';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { OutboxCommandEntry, OutboxWriter } from '@order/domain/shared/outbox.port';
import { OrderOutboxOrmEntity } from '@order/infrastructure/persistence/entities/order-outbox.orm-entity';
import { getTransactionalEntityManager } from '@order/infrastructure/persistence/transaction/transactional-entity-manager';
import { type DataSource, In, IsNull, type Repository } from 'typeorm';

interface UnpublishedRow {
  id: string;
  aggregate_id: string;
  topic: string;
  event_type: string;
  payload: Record<string, unknown>;
  tenant_id: string;
  correlation_id: string;
  created_at: Date;
}

/**
 * Two roles over the same `order_outbox` table:
 * - `OutboxWriter.append` — enlists in the caller's transaction so a command
 *   row commits atomically with the order/saga change that emitted it. Tenant is
 *   read from the tenant context (never the entry) so no call site can spoof it;
 *   a fresh `correlation_id` is minted since request correlation isn't threaded
 *   into the service layer yet and the header must be non-null.
 * - `OutboxPort.fetchUnpublished` / `markPublished` — the relay's drain. Claims
 *   a batch with `FOR UPDATE SKIP LOCKED` so overlapping ticks pick DIFFERENT
 *   rows, maps each to a keyed Kafka record (key = order id) with the six
 *   envelope headers, then marks them published. At-least-once: consumers dedupe
 *   by event id (the row `id`).
 */
@Injectable()
export class TypeOrmOrderOutboxAdapter implements OutboxWriter, OutboxPort {
  constructor(
    @InjectRepository(OrderOutboxOrmEntity)
    private readonly outboxRepository: Repository<OrderOutboxOrmEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  /** Enlists in the active transaction so the outbox row commits with its emitter's write. */
  private get repository(): Repository<OrderOutboxOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(OrderOutboxOrmEntity) ?? this.outboxRepository
    );
  }

  async append(entry: OutboxCommandEntry): Promise<void> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const row = this.repository.create({
      aggregateId: entry.aggregateId,
      topic: entry.topic,
      eventType: entry.eventType,
      payload: entry.payload,
      tenantId,
      correlationId: randomUUID(),
      publishedAt: null,
    });
    await this.repository.save(row);
  }

  async fetchUnpublished(limit: number): Promise<OutboxRecord[]> {
    // Claim + read in one short transaction: the row lock (SKIP LOCKED) is held
    // only for this select, letting a second relay tick grab a different batch.
    const rows = await this.dataSource.transaction<UnpublishedRow[]>((manager) =>
      manager
        .getRepository(OrderOutboxOrmEntity)
        .createQueryBuilder('outbox')
        .select([
          'outbox.id AS id',
          'outbox.aggregate_id AS aggregate_id',
          'outbox.topic AS topic',
          'outbox.event_type AS event_type',
          'outbox.payload AS payload',
          'outbox.tenant_id AS tenant_id',
          'outbox.correlation_id AS correlation_id',
          'outbox.created_at AS created_at',
        ])
        .where('outbox.published_at IS NULL')
        .orderBy('outbox.created_at', 'ASC')
        .limit(limit)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getRawMany<UnpublishedRow>(),
    );

    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      key: row.aggregate_id,
      headers: encodeHeaders({
        eventId: row.id,
        eventType: row.event_type,
        aggregateId: row.aggregate_id,
        tenantId: row.tenant_id,
        correlationId: row.correlation_id,
        occurredAt: new Date(row.created_at).toISOString(),
      }),
      value: row.payload,
    }));
  }

  async markPublished(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.outboxRepository.update(
      { id: In(ids), publishedAt: IsNull() },
      { publishedAt: new Date() },
    );
  }
}
