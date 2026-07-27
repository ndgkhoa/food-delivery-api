import { PlaceOrderItemRequest } from '@order/interface/http/dto/place-order-item.request';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';

export class PlaceOrderRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlaceOrderItemRequest)
  items!: PlaceOrderItemRequest[];
}
