import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

/**
 * `GET /analytics/top-restaurants` query params. `limit` is capped at 100 so
 * a caller can never force an unbounded (or pathologically deep) ranking scan.
 */
export class TopRestaurantsQueryRequest {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
