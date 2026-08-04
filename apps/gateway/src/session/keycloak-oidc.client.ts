import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface KeycloakTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  token_type?: string;
  id_token?: string;
  scope?: string;
  session_state?: string;
}

@Injectable()
export class KeycloakOidcClient {
  private readonly logger = new Logger(KeycloakOidcClient.name);
  private readonly tokenUrl: string;
  private readonly logoutUrl: string;
  private readonly clientId: string;

  constructor(config: ConfigService) {
    const baseUrl = config.getOrThrow<string>('KEYCLOAK_URL').replace(/\/$/, '');
    const realm = config.getOrThrow<string>('KEYCLOAK_REALM');
    const oidc = `${baseUrl}/realms/${realm}/protocol/openid-connect`;
    this.tokenUrl = `${oidc}/token`;
    this.logoutUrl = `${oidc}/logout`;
    this.clientId = config.getOrThrow<string>('KEYCLOAK_SPA_CLIENT_ID');
  }

  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<KeycloakTokenSet> {
    return this.requestTokens(
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: input.redirectUri,
      }),
    );
  }

  refresh(refreshToken: string): Promise<KeycloakTokenSet> {
    return this.requestTokens(
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        refresh_token: refreshToken,
      }),
    );
  }

  async logout(refreshToken: string): Promise<void> {
    const response = await fetch(this.logoutUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, refresh_token: refreshToken }),
    });
    if (!response.ok) {
      this.logger.error(`Keycloak logout failed (${response.status})`);
      throw new HttpException('Logout failed', HttpStatus.BAD_GATEWAY);
    }
  }

  private async requestTokens(body: URLSearchParams): Promise<KeycloakTokenSet> {
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const oauthError = typeof payload.error === 'string' ? payload.error : 'invalid_request';
      const status =
        oauthError === 'invalid_grant' ? HttpStatus.UNAUTHORIZED : HttpStatus.BAD_REQUEST;
      throw new HttpException(
        {
          statusCode: status,
          code: oauthError,
          message: `OAuth token exchange failed: ${oauthError}`,
        },
        status,
      );
    }
    return payload as unknown as KeycloakTokenSet;
  }
}
