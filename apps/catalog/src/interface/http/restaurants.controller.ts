import { CreateRestaurantHandler } from '@catalog/application/restaurant/commands/create-restaurant.handler';
import { DeleteRestaurantHandler } from '@catalog/application/restaurant/commands/delete-restaurant.handler';
import { UpdateRestaurantHandler } from '@catalog/application/restaurant/commands/update-restaurant.handler';
import { GetRestaurantViewHandler } from '@catalog/application/restaurant/queries/get-restaurant-view.handler';
import { ListRestaurantsHandler } from '@catalog/application/restaurant/queries/list-restaurants.handler';
import { CreateRestaurantRequest } from '@catalog/interface/http/dto/create-restaurant.request';
import type { PaginatedResponse } from '@catalog/interface/http/dto/paginated.response';
import { PaginationRequest } from '@catalog/interface/http/dto/pagination.request';
import type { RestaurantResponse } from '@catalog/interface/http/dto/restaurant.response';
import { UpdateRestaurantRequest } from '@catalog/interface/http/dto/update-restaurant.request';
import { RestaurantResponseMapper } from '@catalog/interface/http/mappers/restaurant-response.mapper';
import { Roles } from '@food-delivery-api/shared-tenancy';
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

/** Only owners/admins may mutate the catalog; reads stay open to any authenticated tenant. */
const CATALOG_WRITE_ROLES = ['restaurant-owner', 'admin'] as const;

@Controller('restaurants')
export class RestaurantsController {
  constructor(
    private readonly createRestaurant: CreateRestaurantHandler,
    private readonly updateRestaurant: UpdateRestaurantHandler,
    private readonly deleteRestaurant: DeleteRestaurantHandler,
    private readonly listRestaurants: ListRestaurantsHandler,
    private readonly getRestaurant: GetRestaurantViewHandler,
  ) {}

  @Post()
  @Roles(...CATALOG_WRITE_ROLES)
  async create(@Body() dto: CreateRestaurantRequest): Promise<RestaurantResponse> {
    const restaurant = await this.createRestaurant.execute(dto);
    return RestaurantResponseMapper.toResponse(restaurant);
  }

  @Get()
  async findAll(
    @Query() pagination: PaginationRequest,
  ): Promise<PaginatedResponse<RestaurantResponse>> {
    const result = await this.listRestaurants.execute(pagination);
    return { ...result, data: result.data.map(RestaurantResponseMapper.toResponse) };
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<RestaurantResponse> {
    const restaurant = await this.getRestaurant.execute(id);
    return RestaurantResponseMapper.toResponse(restaurant);
  }

  @Patch(':id')
  @Roles(...CATALOG_WRITE_ROLES)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRestaurantRequest,
  ): Promise<RestaurantResponse> {
    const restaurant = await this.updateRestaurant.execute(id, dto);
    return RestaurantResponseMapper.toResponse(restaurant);
  }

  @Delete(':id')
  @Roles(...CATALOG_WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteRestaurant.execute(id);
  }
}
