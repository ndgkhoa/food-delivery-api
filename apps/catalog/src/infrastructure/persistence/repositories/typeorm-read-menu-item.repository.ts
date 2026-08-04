import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type {
  ReadMenuItemRepository,
  ReadMenuItemRow,
} from '@catalog/domain/read-model/read-menu-item.repository';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';
import { ReadMenuItemOrmEntity } from '@catalog/infrastructure/persistence/entities/read-menu-item.orm-entity';
import { ReadMenuItemMapper } from '@catalog/infrastructure/persistence/mappers/read-menu-item.mapper';
import { getTransactionalEntityManager } from '@catalog/infrastructure/persistence/transaction/transactional-entity-manager';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmReadMenuItemRepository implements ReadMenuItemRepository {
  constructor(
    @InjectRepository(ReadMenuItemOrmEntity)
    private readonly ormRepository: Repository<ReadMenuItemOrmEntity>,
  ) {}

  private get repository(): Repository<ReadMenuItemOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(ReadMenuItemOrmEntity) ?? this.ormRepository
    );
  }

  async findAndCountByRestaurant(
    tenantId: string,
    restaurantId: string,
    pagination: Pagination,
  ): Promise<PageResult<MenuItem>> {
    const [rows, total] = await this.repository.findAndCount({
      where: { tenantId, restaurantId },
      order: { createdAt: 'DESC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });
    return { data: rows.map(ReadMenuItemMapper.toDomain), total };
  }

  async upsert(row: ReadMenuItemRow): Promise<void> {
    await this.repository.upsert(ReadMenuItemMapper.toOrm(row), ['id']);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.repository.delete({ id, tenantId });
  }

  async removeByRestaurant(restaurantId: string, tenantId: string): Promise<void> {
    await this.repository.delete({ restaurantId, tenantId });
  }
}
