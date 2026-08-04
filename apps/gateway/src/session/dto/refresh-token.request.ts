import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshTokenRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  refreshToken!: string;
}
