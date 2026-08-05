import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class TokenExchangeRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  codeVerifier!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  redirectUri!: string;
}
