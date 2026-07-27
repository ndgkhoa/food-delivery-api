import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Authorization-code + PKCE exchange payload. The gateway relays these to
 * Keycloak's token endpoint and stores nothing — `redirect_uri` and
 * `code_verifier` must match what the SPA used to obtain `code`.
 */
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
