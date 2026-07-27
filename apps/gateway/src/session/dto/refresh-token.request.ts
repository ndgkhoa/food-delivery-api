import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Carries a refresh token — shared by `/auth/refresh` (rotate) and
 * `/auth/logout` (revoke) since both take exactly the same input.
 */
export class RefreshTokenRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  refreshToken!: string;
}
