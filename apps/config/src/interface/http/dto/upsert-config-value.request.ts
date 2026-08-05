import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpsertConfigValueRequest {
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  value!: number;

  @IsOptional()
  @IsBoolean()
  global?: boolean;
}
