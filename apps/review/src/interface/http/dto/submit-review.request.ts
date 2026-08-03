import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** Trims incoming strings so a whitespace-only comment normalizes to empty rather than reaching the domain. */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SubmitReviewRequest {
  @IsUUID()
  orderId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  /** Untrusted free text — bounded to 1000 chars and never interpolated into a search/ES query. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
