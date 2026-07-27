import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { MenuItemRepository } from '@catalog/domain/menu-item/menu-item.repository';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';
import { MenuItemOrmEntity } from '@catalog/infrastructure/persistence/entities/menu-item.orm-entity';
import { MenuItemMapper } from '@catalog/infrastructure/persistence/mappers/menu-item.mapper';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmMenuItemRepository implements MenuItemRepository {
  constructor(
    @InjectRepository(MenuItemOrmEntity)
    private readonly ormRepository: Repository<MenuItemOrmEntity>,
  ) {}

  async save(menuItem: MenuItem): Promise<MenuItem> {
    const orm = MenuItemMapper.toOrm(menuItem);
    const saved = await this.ormRepository.save(orm);
    return MenuItemMapper.toDomain(saved);
  }

  async findById(id: string, restaurantId: string, tenantId: string): Promise<MenuItem | null> {
    const orm = await this.ormRepository.findOne({ where: { id, restaurantId, tenantId } });
    return orm ? MenuItemMapper.toDomain(orm) : null;
  }

  async findAndCountByRestaurant(
    tenantId: string,
    restaurantId: string,
    pagination: Pagination,
  ): Promise<PageResult<MenuItem>> {
    const [rows, total] = await this.ormRepository.findAndCount({
      where: { tenantId, restaurantId },
      order: { createdAt: 'DESC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });

    return { data: rows.map(MenuItemMapper.toDomain), total };
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    await this.ormRepository.softDelete({ id, tenantId });
  }
}
