import { CreateRestaurantRequest } from '@catalog/interface/http/dto/create-restaurant.request';
import { PartialType } from '@nestjs/mapped-types';

export class UpdateRestaurantRequest extends PartialType(CreateRestaurantRequest) {}
