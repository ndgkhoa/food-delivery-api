import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/** Trims incoming strings so a whitespace-only value is rejected by validation (400) rather than reaching the domain (500). */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateMenuItemRequest {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  description?: string;

  /** Integer cents, e.g. 1299 = $12.99 — never a float, to avoid rounding errors. */
  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}
