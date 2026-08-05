import type { Stock } from '@inventory/domain/stock/stock';
import type { StockRepository } from '@inventory/domain/stock/stock.repository';
import { StockOrmEntity } from '@inventory/infrastructure/persistence/entities/stock.orm-entity';
import { StockMapper } from '@inventory/infrastructure/persistence/mappers/stock.mapper';
import { getTransactionalEntityManager } from '@inventory/infrastructure/persistence/transaction/transactional-entity-manager';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';

@Injectable()
export class TypeOrmStockRepository implements StockRepository {
  constructor(
    @InjectRepository(StockOrmEntity)
    private readonly ormRepository: Repository<StockOrmEntity>,
  ) {}

  private get repository(): Repository<StockOrmEntity> {
    return getTransactionalEntityManager()?.getRepository(StockOrmEntity) ?? this.ormRepository;
  }

  async findByItemIds(tenantId: string, itemIds: string[]): Promise<Stock[]> {
    if (itemIds.length === 0) {
      return [];
    }
    const rows = await this.repository.find({ where: { tenantId, itemId: In(itemIds) } });
    return rows.map(StockMapper.toDomain);
  }

  async decrementIfAvailable(tenantId: string, itemId: string, qty: number): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(StockOrmEntity)
      .set({ available: () => 'available - :byQty', updatedAt: () => 'now()' })
      .where('tenant_id = :tenantId AND item_id = :itemId AND available >= :byQty', {
        tenantId,
        itemId,
        byQty: qty,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async increaseAvailable(tenantId: string, itemId: string, qty: number): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(StockOrmEntity)
      .set({ available: () => 'available + :byQty', updatedAt: () => 'now()' })
      .where('tenant_id = :tenantId AND item_id = :itemId', { tenantId, itemId })
      .setParameter('byQty', qty)
      .execute();
  }
}
