import { IsBoolean, IsOptional } from 'class-validator';

export class UpsertFeatureFlagRequest {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsBoolean()
  global?: boolean;
}
