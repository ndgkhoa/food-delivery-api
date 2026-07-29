import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpsertConfigValueRequest {
  @IsInt()
  @Min(0)
  // Bound to the safe-integer range: the config-client maps the BIGINT column
  // through a JS number, so a larger value would lose precision. Rejecting it as
  // a 400 here beats a 500 (unmapped domain error) or a silently-truncated read.
  @Max(Number.MAX_SAFE_INTEGER)
  value!: number;

  /** Writes the GLOBAL default (`tenant_id NULL`) instead of the caller's own tenant override — requires the `platform-admin` role. */
  @IsOptional()
  @IsBoolean()
  global?: boolean;
}
