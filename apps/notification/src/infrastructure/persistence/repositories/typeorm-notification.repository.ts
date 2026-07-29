import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { NewNotification, Notification } from '@notification/domain/notification/notification';
import type { NotificationRepository } from '@notification/domain/notification/notification.repository';
import { NotificationOrmEntity } from '@notification/infrastructure/persistence/entities/notification.orm-entity';
import { toDomain } from '@notification/infrastructure/persistence/mappers/notification.mapper';
import { getTransactionalEntityManager } from '@notification/infrastructure/persistence/transaction/transactional-entity-manager';
import type { Repository } from 'typeorm';

/**
 * TypeORM adapter for the `notifications` ledger. `createPendingBatch`
 * enlists in the caller's transaction (the same one `processed_events` is
 * written in) so a dispatched event's rows and its dedupe marker commit
 * atomically; the status-transition methods run from the worker outside any
 * transaction — each is a single-row update with no invariant spanning
 * multiple writes, so the base (non-transactional) repository is enough.
 */
@Injectable()
export class TypeOrmNotificationRepository implements NotificationRepository {
  constructor(
    @InjectRepository(NotificationOrmEntity)
    private readonly baseRepository: Repository<NotificationOrmEntity>,
  ) {}

  private get repository(): Repository<NotificationOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(NotificationOrmEntity) ?? this.baseRepository
    );
  }

  async createPendingBatch(rows: NewNotification[]): Promise<Notification[]> {
    const entities = this.repository.create(
      rows.map((row) => ({ ...row, status: 'PENDING' as const, attempts: 0, error: null })),
    );
    const saved = await this.repository.save(entities);
    return saved.map(toDomain);
  }

  async findPendingByEvent(tenantId: string, eventId: string): Promise<Notification[]> {
    const entities = await this.baseRepository.find({
      where: { tenantId, eventId, status: 'PENDING' },
    });
    return entities.map(toDomain);
  }

  async findById(id: string): Promise<Notification | null> {
    const entity = await this.baseRepository.findOneBy({ id });
    return entity ? toDomain(entity) : null;
  }

  async markSent(id: string): Promise<void> {
    await this.baseRepository.update({ id }, { status: 'SENT', error: null });
  }

  async markFailed(id: string, attempts: number, error: string): Promise<void> {
    await this.baseRepository.update({ id }, { status: 'FAILED', attempts, error });
  }

  async markDead(id: string, attempts: number, error: string): Promise<void> {
    await this.baseRepository.update({ id }, { status: 'DEAD', attempts, error });
  }
}
