import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMenuItemRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
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
