import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  EligibleOrderRow,
  ReviewEligibleOrderRepository,
} from '@review/domain/eligibility/review-eligible-order.repository';
import { ReviewEligibleOrderOrmEntity } from '@review/infrastructure/persistence/entities/review-eligible-order.orm-entity';
import { getTransactionalEntityManager } from '@review/infrastructure/persistence/transaction/transactional-entity-manager';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmReviewEligibleOrderRepository implements ReviewEligibleOrderRepository {
  constructor(
    @InjectRepository(ReviewEligibleOrderOrmEntity)
    private readonly ormRepository: Repository<ReviewEligibleOrderOrmEntity>,
  ) {}

  private get repository(): Repository<ReviewEligibleOrderOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(ReviewEligibleOrderOrmEntity) ??
      this.ormRepository
    );
  }

  /** All columns besides the `orderId` PK are safe to fully overwrite: a redelivered `OrderConfirmed` always carries the same values. */
  async upsertEligible(row: EligibleOrderRow): Promise<void> {
    await this.repository.upsert(
      {
        orderId: row.orderId,
        tenantId: row.tenantId,
        userId: row.userId,
        restaurantId: row.restaurantId,
      },
      ['orderId'],
    );
  }

  async findEligible(tenantId: string, orderId: string): Promise<EligibleOrderRow | null> {
    const orm = await this.repository.findOne({ where: { orderId, tenantId } });
    return orm
      ? {
          orderId: orm.orderId,
          tenantId: orm.tenantId,
          userId: orm.userId,
          restaurantId: orm.restaurantId,
        }
      : null;
  }
}
