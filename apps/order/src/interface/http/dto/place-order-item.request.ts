import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class PlaceOrderItemRequest {
  @IsUUID()
  itemId!: string;

  @IsInt()
  @IsPositive()
  qty!: number;
}
