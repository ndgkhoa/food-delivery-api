import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpsertConfigValueRequest {
  @IsInt()
  @Min(0)
  // Bound to the 32-bit signed-int ceiling: these values feed integer money
  // columns in the consuming services (e.g. order's int4 delivery_fee/discount),
  // so a larger value would only overflow on insert there. Rejecting it as a 400
  // at write time keeps a bad config value from ever reaching a consumer.
  @Max(2_147_483_647)
  value!: number;

  /** Writes the GLOBAL default (`tenant_id NULL`) instead of the caller's own tenant override — requires the `platform-admin` role. */
  @IsOptional()
  @IsBoolean()
  global?: boolean;
}
