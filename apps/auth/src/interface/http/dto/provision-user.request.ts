import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsString, MinLength } from 'class-validator';

export const PROVISIONABLE_ROLES = ['admin', 'restaurant-owner', 'customer', 'driver'] as const;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ProvisionUserRequest {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  username!: string;

  @Transform(trim)
  @IsEmail()
  email!: string;

  @IsIn(PROVISIONABLE_ROLES)
  role!: (typeof PROVISIONABLE_ROLES)[number];

  @IsString()
  @MinLength(8)
  password!: string;
}
