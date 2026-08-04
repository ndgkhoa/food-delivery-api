import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { IdempotencyRepository } from '@order/domain/idempotency/idempotency.repository';
import { IdempotencyKeyOrmEntity } from '@order/infrastructure/persistence/entities/idempotency-key.orm-entity';
import { IdempotencyKeyMapper } from '@order/infrastructure/persistence/mappers/idempotency-key.mapper';
import { getTransactionalEntityManager } from '@order/infrastructure/persistence/transaction/transactional-entity-manager';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmIdempotencyRepository implements IdempotencyRepository {
  constructor(
    @InjectRepository(IdempotencyKeyOrmEntity)
    private readonly ormRepository: Repository<IdempotencyKeyOrmEntity>,
  ) {}

  private get repository(): Repository<IdempotencyKeyOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(IdempotencyKeyOrmEntity) ?? this.ormRepository
    );
  }

  async findOrderId(tenantId: string, userId: string, key: string): Promise<string | undefined> {
    const row = await this.repository.findOne({ where: { tenantId, userId, key } });
    return row?.orderId;
  }

  async save(tenantId: string, userId: string, key: string, orderId: string): Promise<void> {
    await this.repository.insert(IdempotencyKeyMapper.toOrm(tenantId, userId, key, orderId));
  }
}
