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
import { CreateRestaurantHandler } from '../../application/restaurant/commands/create-restaurant.handler';
import { DeleteRestaurantHandler } from '../../application/restaurant/commands/delete-restaurant.handler';
import { UpdateRestaurantHandler } from '../../application/restaurant/commands/update-restaurant.handler';
import { GetRestaurantHandler } from '../../application/restaurant/queries/get-restaurant.handler';
import { ListRestaurantsHandler } from '../../application/restaurant/queries/list-restaurants.handler';
import { CreateRestaurantRequest } from './dto/create-restaurant.request';
import type { PaginatedResponse } from './dto/paginated.response';
import { PaginationRequest } from './dto/pagination.request';
import type { RestaurantResponse } from './dto/restaurant.response';
import { UpdateRestaurantRequest } from './dto/update-restaurant.request';
import { RestaurantResponseMapper } from './mappers/restaurant-response.mapper';

@Controller('restaurants')
export class RestaurantsController {
  constructor(
    private readonly createRestaurant: CreateRestaurantHandler,
    private readonly updateRestaurant: UpdateRestaurantHandler,
    private readonly deleteRestaurant: DeleteRestaurantHandler,
    private readonly listRestaurants: ListRestaurantsHandler,
    private readonly getRestaurant: GetRestaurantHandler,
  ) {}

  @Post()
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
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRestaurantRequest,
  ): Promise<RestaurantResponse> {
    const restaurant = await this.updateRestaurant.execute(id, dto);
    return RestaurantResponseMapper.toResponse(restaurant);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteRestaurant.execute(id);
  }
}
