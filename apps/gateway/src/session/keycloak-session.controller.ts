import { Public } from '@gateway/guards/public.decorator';
import { RefreshTokenRequest } from '@gateway/session/dto/refresh-token.request';
import { TokenExchangeRequest } from '@gateway/session/dto/token-exchange.request';
import { KeycloakOidcClient, type KeycloakTokenSet } from '@gateway/session/keycloak-oidc.client';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

@Public()
@Controller('auth')
export class KeycloakSessionController {
  constructor(private readonly oidc: KeycloakOidcClient) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  exchange(@Body() dto: TokenExchangeRequest): Promise<KeycloakTokenSet> {
    return this.oidc.exchangeCode({
      code: dto.code,
      codeVerifier: dto.codeVerifier,
      redirectUri: dto.redirectUri,
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenRequest): Promise<KeycloakTokenSet> {
    return this.oidc.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() dto: RefreshTokenRequest): Promise<void> {
    return this.oidc.logout(dto.refreshToken);
  }
}
