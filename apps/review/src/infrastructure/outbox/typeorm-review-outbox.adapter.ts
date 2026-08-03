import { randomUUID } from 'node:crypto';
import {
  encodeHeaders,
  type OutboxPort,
  type OutboxRecord,
} from '@food-delivery-api/shared-messaging';
import { captureActiveTraceContext } from '@food-delivery-api/shared-observability';
import { withAdvisoryLock } from '@food-delivery-api/shared-persistence';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { OutboxCommandEntry, OutboxWriter } from '@review/domain/shared/outbox.port';
import { ReviewOutboxOrmEntity } from '@review/infrastructure/persistence/entities/review-outbox.orm-entity';
import { getTransactionalEntityManager } from '@review/infrastructure/persistence/transaction/transactional-entity-manager';
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
 * Distinct per-service Postgres advisory-lock key so the review relay's drain
 * serializes across HPA replicas. Only needs to be unique within review's own
 * database (each service owns its database), but kept distinct from the other
 * services' keys (order 4001, payment 4002, inventory 4003) for clarity.
 */
const OUTBOX_RELAY_LOCK_KEY = 4004;

/**
 * Two roles over the same `review_outbox` table, mirroring order's
 * `TypeOrmOrderOutboxAdapter`:
 * - `OutboxWriter.append` — enlists in the caller's transaction so the
 *   `RestaurantRatingChanged` row commits atomically with the review insert.
 *   Tenant is read from the tenant context (never the entry) so no call site
 *   can spoof it.
 * - `OutboxPort.fetchUnpublished` / `markPublished` — the relay's drain, with
 *   `FOR UPDATE SKIP LOCKED` so overlapping ticks claim DIFFERENT rows.
 *   At-least-once: consumers dedupe by event id (the row `id`) where needed
 *   (catalog/search's rating projections are naturally idempotent either way).
 * - `OutboxPort.runExclusively` — wraps the whole drain in a session-held
 *   advisory lock so only one HPA replica drains at a time, avoiding
 *   duplicate-publish amplification across replicas.
 */
@Injectable()
export class TypeOrmReviewOutboxAdapter implements OutboxWriter, OutboxPort {
  constructor(
    @InjectRepository(ReviewOutboxOrmEntity)
    private readonly outboxRepository: Repository<ReviewOutboxOrmEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  private get repository(): Repository<ReviewOutboxOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(ReviewOutboxOrmEntity) ?? this.outboxRepository
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

  async incrementAttempts(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.outboxRepository.increment({ id: In(ids) }, 'attempts', 1);
  }

  async fetchUnpublished(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.dataSource.transaction<UnpublishedRow[]>((manager) =>
      manager
        .getRepository(ReviewOutboxOrmEntity)
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

  async runExclusively<T>(drain: () => Promise<T>): Promise<{ ran: boolean; result?: T }> {
    const outcome = await withAdvisoryLock(this.dataSource, OUTBOX_RELAY_LOCK_KEY, drain);
    return outcome.ran ? { ran: true, result: outcome.result } : { ran: false };
  }
}
