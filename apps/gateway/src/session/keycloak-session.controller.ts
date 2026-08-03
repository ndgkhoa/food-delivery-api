import { Public } from '@gateway/guards/public.decorator';
import { RefreshTokenRequest } from '@gateway/session/dto/refresh-token.request';
import { TokenExchangeRequest } from '@gateway/session/dto/token-exchange.request';
import { KeycloakOidcClient, type KeycloakTokenSet } from '@gateway/session/keycloak-oidc.client';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

/**
 * Stateless session edge → Keycloak OIDC. PUBLIC (these routes establish/rotate
 * a session, so they cannot require a token) but still IP-rate-limited by the
 * global guard. Must be registered BEFORE `AuthProxyController` (whose `@All`
 * catch-all also matches `/auth/*`) so these specific routes win.
 */
@Public()
@Controller('auth')
export class KeycloakSessionController {
  constructor(private readonly oidc: KeycloakOidcClient) {}

  /** Authorization-code + PKCE exchange. */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  exchange(@Body() dto: TokenExchangeRequest): Promise<KeycloakTokenSet> {
    return this.oidc.exchangeCode({
      code: dto.code,
      codeVerifier: dto.codeVerifier,
      redirectUri: dto.redirectUri,
    });
  }

  /** Rotate a refresh token for a fresh token set. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenRequest): Promise<KeycloakTokenSet> {
    return this.oidc.refresh(dto.refreshToken);
  }

  /** Revoke the refresh token + end the Keycloak session. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() dto: RefreshTokenRequest): Promise<void> {
    return this.oidc.logout(dto.refreshToken);
  }
}
