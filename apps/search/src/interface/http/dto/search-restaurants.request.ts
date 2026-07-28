import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Full-text search params. `q` is trimmed and length-bounded so an empty or
 * pathologically long query can never reach Elasticsearch; pagination is capped
 * to keep result windows cheap.
 */
export class SearchRestaurantsRequest {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
