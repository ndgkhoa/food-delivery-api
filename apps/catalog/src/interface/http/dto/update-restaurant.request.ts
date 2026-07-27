import { PartialType } from '@nestjs/mapped-types';
import { CreateRestaurantRequest } from './create-restaurant.request';

export class UpdateRestaurantRequest extends PartialType(CreateRestaurantRequest) {}
