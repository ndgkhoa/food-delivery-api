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

  /** Enlists in the active transaction when one is open, else the default connection. */
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

  async save(stock: Stock): Promise<Stock> {
    const saved = await this.repository.save(StockMapper.toOrm(stock));
    return StockMapper.toDomain(saved);
  }
}
