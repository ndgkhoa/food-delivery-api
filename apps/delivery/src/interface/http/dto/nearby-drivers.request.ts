import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Query params for the nearby-drivers lookup. `lat`/`lng` are the required search
 * origin (e.g. the restaurant / delivery point) and are bounds-checked as real
 * coordinates; `radius` (metres) is optional and further clamped to the service
 * maximum by the query handler, so a caller can never force an unbounded scan.
 */
export class NearbyDriversRequest {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  radius?: number;
}
