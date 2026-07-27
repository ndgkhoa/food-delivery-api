import { SharedAuthModule } from '@food-delivery-api/shared-auth';
import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { gatewayEnvSchema } from '@gateway/config/gateway-env-schema';
import { JwtAuthGuard } from '@gateway/guards/jwt-auth.guard';
import { CatalogProxyController } from '@gateway/proxy/catalog-proxy.controller';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Composition root for the edge gateway. It owns no domain — only cross-cutting
 * concerns (config, logging, JWT verification) and the reverse-proxy to
 * downstream bounded contexts. JWKS/issuer/audience come from config so the
 * same build points at Keycloak in prod and a test JWKS in e2e.
 */
@Module({
  imports: [
    SharedConfigModule.forRoot(gatewayEnvSchema),
    SharedLoggingModule.forRoot(),
    SharedAuthModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Derive issuer + JWKS from the Keycloak base URL + realm so a token's
        // `iss` and the key set the gateway trusts can never drift apart.
        const issuer = `${config.getOrThrow<string>('KEYCLOAK_URL').replace(/\/$/, '')}/realms/${config.getOrThrow<string>('KEYCLOAK_REALM')}`;
        return {
          jwksUri: `${issuer}/protocol/openid-connect/certs`,
          issuer,
          audience: config.getOrThrow<string>('JWT_AUDIENCE'),
          clockToleranceSec: config.get<number>('JWT_CLOCK_TOLERANCE_SEC'),
        };
      },
    }),
  ],
  controllers: [CatalogProxyController],
  providers: [JwtAuthGuard, HttpForwarder],
})
export class AppModule {}
