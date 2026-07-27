import { IsInt, IsPositive, IsUUID, Max } from 'class-validator';

/** Upper bound on a single line's quantity — rejects absurd values (overflow) at the edge. */
const MAX_LINE_QTY = 10_000;

export class PlaceOrderItemRequest {
  @IsUUID()
  itemId!: string;

  @IsInt()
  @IsPositive()
  @Max(MAX_LINE_QTY)
  qty!: number;
}
