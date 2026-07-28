import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Autocomplete params. `q` is trimmed + length-bounded (a shorter cap than full
 * search — prefixes are short); `limit` is capped low since suggestions are a
 * dropdown, not a result page.
 */
export class AutocompleteRestaurantsRequest {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit: number = 10;
}
