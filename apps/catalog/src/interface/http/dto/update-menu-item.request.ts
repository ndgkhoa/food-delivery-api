import { PartialType } from '@nestjs/mapped-types';
import { CreateMenuItemRequest } from './create-menu-item.request';

export class UpdateMenuItemRequest extends PartialType(CreateMenuItemRequest) {}
