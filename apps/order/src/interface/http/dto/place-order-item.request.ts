import { IsInt, IsPositive, IsUUID, Max } from 'class-validator';

const MAX_LINE_QTY = 10_000;

export class PlaceOrderItemRequest {
  @IsUUID()
  itemId!: string;

  @IsInt()
  @IsPositive()
  @Max(MAX_LINE_QTY)
  qty!: number;
}
