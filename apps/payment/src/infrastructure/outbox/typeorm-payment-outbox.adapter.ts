import { randomUUID } from 'node:crypto';
import {
  encodeHeaders,
  type OutboxPort,
  type OutboxRecord,
} from '@food-delivery-api/shared-messaging';
import { captureActiveTraceContext } from '@food-delivery-api/shared-observability';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { OutboxCommandEntry, OutboxWriter } from '@payment/domain/shared/outbox.port';
import { PaymentOutboxOrmEntity } from '@payment/infrastructure/persistence/entities/payment-outbox.orm-entity';
import { getTransactionalEntityManager } from '@payment/infrastructure/persistence/transaction/transactional-entity-manager';
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
  trace_parent: string | null;
}

/**
 * `OutboxWriter.append` enlists in the caller's transaction so a reply row
 * commits atomically with its dedupe marker; tenant is read from the tenant
 * context (set by the consumer from the command header) and the triggering
 * command's `correlationId` is carried onto the reply (minted only when absent)
 * so the saga shares one trace id. `OutboxPort.fetchUnpublished` / `markPublished` are the relay's drain:
 * claim a batch with `FOR UPDATE SKIP LOCKED`, map each to a keyed Kafka record
 * (key = order id) with the six envelope headers, publish, mark done.
 */
@Injectable()
export class TypeOrmPaymentOutboxAdapter implements OutboxWriter, OutboxPort {
  constructor(
    @InjectRepository(PaymentOutboxOrmEntity)
    private readonly outboxRepository: Repository<PaymentOutboxOrmEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  private get repository(): Repository<PaymentOutboxOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(PaymentOutboxOrmEntity) ??
      this.outboxRepository
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
      correlationId: entry.correlationId ?? randomUUID(),
      publishedAt: null,
      traceParent: captureActiveTraceContext().traceparent ?? null,
    });
    await this.repository.save(row);
  }

  /** Bumps `attempts` for rows whose relay publish just failed — poison-row visibility. */
  async incrementAttempts(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.outboxRepository.increment({ id: In(ids) }, 'attempts', 1);
  }

  async fetchUnpublished(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.dataSource.transaction<UnpublishedRow[]>((manager) =>
      manager
        .getRepository(PaymentOutboxOrmEntity)
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
          'outbox.trace_parent AS trace_parent',
        ])
        .where('outbox.published_at IS NULL')
        .orderBy('outbox.created_at', 'ASC')
        .limit(limit)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getRawMany<UnpublishedRow>(),
    );

    return rows.map((row) => {
      const headers = encodeHeaders({
        eventId: row.id,
        eventType: row.event_type,
        aggregateId: row.aggregate_id,
        tenantId: row.tenant_id,
        correlationId: row.correlation_id,
        occurredAt: new Date(row.created_at).toISOString(),
      });
      // Forwards the ORIGINAL request's trace context captured at append time;
      // the producer's `!headers.traceparent` guard only injects its own
      // (disconnected) span when this is absent — see `kafka-producer.ts`.
      if (row.trace_parent) {
        headers.traceparent = row.trace_parent;
      }
      return {
        id: row.id,
        topic: row.topic,
        key: row.aggregate_id,
        headers,
        value: row.payload,
      };
    });
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
