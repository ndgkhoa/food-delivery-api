import { IsBoolean, IsOptional } from 'class-validator';

export class UpsertFeatureFlagRequest {
  @IsBoolean()
  enabled!: boolean;

  /** Writes the GLOBAL default (`tenant_id NULL`) instead of the caller's own tenant override — requires the `platform-admin` role. */
  @IsOptional()
  @IsBoolean()
  global?: boolean;
}
