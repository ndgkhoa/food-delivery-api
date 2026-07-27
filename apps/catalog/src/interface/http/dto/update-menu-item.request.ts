import { CreateMenuItemRequest } from '@catalog/interface/http/dto/create-menu-item.request';
import { PartialType } from '@nestjs/mapped-types';

export class UpdateMenuItemRequest extends PartialType(CreateMenuItemRequest) {}
