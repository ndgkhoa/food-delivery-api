import { PlaceOrderItemRequest } from '@order/interface/http/dto/place-order-item.request';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';

/** Cap on line items per order — bounds request work and total-amount growth. */
const MAX_ORDER_ITEMS = 100;

export class PlaceOrderRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ORDER_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => PlaceOrderItemRequest)
  items!: PlaceOrderItemRequest[];
}
