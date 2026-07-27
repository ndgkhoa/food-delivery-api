import { CreateMenuItemHandler } from '@catalog/application/menu-item/commands/create-menu-item.handler';
import { DeleteMenuItemHandler } from '@catalog/application/menu-item/commands/delete-menu-item.handler';
import { UpdateMenuItemHandler } from '@catalog/application/menu-item/commands/update-menu-item.handler';
import { GetMenuItemHandler } from '@catalog/application/menu-item/queries/get-menu-item.handler';
import { ListMenuItemsHandler } from '@catalog/application/menu-item/queries/list-menu-items.handler';
import { CreateMenuItemRequest } from '@catalog/interface/http/dto/create-menu-item.request';
import type { MenuItemResponse } from '@catalog/interface/http/dto/menu-item.response';
import type { PaginatedResponse } from '@catalog/interface/http/dto/paginated.response';
import { PaginationRequest } from '@catalog/interface/http/dto/pagination.request';
import { UpdateMenuItemRequest } from '@catalog/interface/http/dto/update-menu-item.request';
import { MenuItemResponseMapper } from '@catalog/interface/http/mappers/menu-item-response.mapper';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

@Controller('restaurants/:restaurantId/menu-items')
export class MenuItemsController {
  constructor(
    private readonly createMenuItem: CreateMenuItemHandler,
    private readonly updateMenuItem: UpdateMenuItemHandler,
    private readonly deleteMenuItem: DeleteMenuItemHandler,
    private readonly listMenuItems: ListMenuItemsHandler,
    private readonly getMenuItem: GetMenuItemHandler,
  ) {}

  @Post()
  async create(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Body() dto: CreateMenuItemRequest,
  ): Promise<MenuItemResponse> {
    const menuItem = await this.createMenuItem.execute(restaurantId, dto);
    return MenuItemResponseMapper.toResponse(menuItem);
  }

  @Get()
  async findAll(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query() pagination: PaginationRequest,
  ): Promise<PaginatedResponse<MenuItemResponse>> {
    const result = await this.listMenuItems.execute(restaurantId, pagination);
    return { ...result, data: result.data.map(MenuItemResponseMapper.toResponse) };
  }

  @Get(':id')
  async findOne(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MenuItemResponse> {
    const menuItem = await this.getMenuItem.execute(restaurantId, id);
    return MenuItemResponseMapper.toResponse(menuItem);
  }

  @Patch(':id')
  async update(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMenuItemRequest,
  ): Promise<MenuItemResponse> {
    const menuItem = await this.updateMenuItem.execute(restaurantId, id, dto);
    return MenuItemResponseMapper.toResponse(menuItem);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.deleteMenuItem.execute(restaurantId, id);
  }
}
