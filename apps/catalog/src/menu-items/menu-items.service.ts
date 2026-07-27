import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action.enum';
import type { PaginatedResult, PaginationQueryDto } from '../common/pagination-query.dto';
import { RestaurantsService } from '../restaurants/restaurants.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { CreateMenuItemDto } from './dto/create-menu-item.dto';
import type { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { MenuItem } from './entities/menu-item.entity';

@Injectable()
export class MenuItemsService {
  constructor(
    @InjectRepository(MenuItem) private readonly menuItemRepository: Repository<MenuItem>,
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
    private readonly restaurantsService: RestaurantsService,
  ) {}

  async create(restaurantId: string, dto: CreateMenuItemDto): Promise<MenuItem> {
    // Confirms the restaurant exists AND belongs to the caller's tenant before nesting a menu item under it.
    await this.restaurantsService.findOne(restaurantId);
    const tenantId = this.tenantContext.getTenantIdOrThrow();

    const menuItem = this.menuItemRepository.create({ ...dto, tenantId, restaurantId });
    const saved = await this.menuItemRepository.save(menuItem);

    await this.auditService.record({
      action: AuditAction.CREATE,
      entity: 'menu_item',
      entityId: saved.id,
      after: saved,
    });

    return saved;
  }

  async findAllForRestaurant(
    restaurantId: string,
    pagination: PaginationQueryDto,
  ): Promise<PaginatedResult<MenuItem>> {
    await this.restaurantsService.findOne(restaurantId);
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const { page, limit } = pagination;

    const [data, total] = await this.menuItemRepository.findAndCount({
      where: { tenantId, restaurantId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async findOne(restaurantId: string, id: string): Promise<MenuItem> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const menuItem = await this.menuItemRepository.findOne({
      where: { id, restaurantId, tenantId },
    });

    if (!menuItem) {
      throw new NotFoundException(`Menu item "${id}" not found on restaurant "${restaurantId}"`);
    }

    return menuItem;
  }

  async update(restaurantId: string, id: string, dto: UpdateMenuItemDto): Promise<MenuItem> {
    const before = await this.findOne(restaurantId, id);
    const merged = this.menuItemRepository.merge({ ...before }, dto);
    const saved = await this.menuItemRepository.save(merged);

    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity: 'menu_item',
      entityId: id,
      before,
      after: saved,
    });

    return saved;
  }

  async remove(restaurantId: string, id: string): Promise<void> {
    const before = await this.findOne(restaurantId, id);
    await this.menuItemRepository.softDelete({ id: before.id, tenantId: before.tenantId });

    await this.auditService.record({
      action: AuditAction.DELETE,
      entity: 'menu_item',
      entityId: id,
      before,
    });
  }
}
