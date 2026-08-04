import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { JwtVerificationModule } from '@food-delivery-api/shared-jwt';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { gatewayEnvSchema } from '@gateway/config/gateway-env-schema';
import { JwtAuthGuard } from '@gateway/guards/jwt-auth.guard';
import { HealthController } from '@gateway/health/health.controller';
import { AnalyticsProxyController } from '@gateway/proxy/analytics-proxy.controller';
import { AuthProxyController } from '@gateway/proxy/auth-proxy.controller';
import { CatalogProxyController } from '@gateway/proxy/catalog-proxy.controller';
import { CircuitBreakerRegistry } from '@gateway/proxy/circuit-breaker.registry';
import { ConfigProxyController } from '@gateway/proxy/config-proxy.controller';
import { DeliveryProxyController } from '@gateway/proxy/delivery-proxy.controller';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import { MediaProxyController } from '@gateway/proxy/media-proxy.controller';
import { OrderProxyController } from '@gateway/proxy/order-proxy.controller';
import { ReviewProxyController } from '@gateway/proxy/review-proxy.controller';
import { SearchProxyController } from '@gateway/proxy/search-proxy.controller';
import { RateLimitGuard } from '@gateway/rate-limit/rate-limit.guard';
import { RateLimitModule } from '@gateway/rate-limit/rate-limit.module';
import { KeycloakOidcClient } from '@gateway/session/keycloak-oidc.client';
import { KeycloakSessionController } from '@gateway/session/keycloak-session.controller';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    SharedConfigModule.forRoot(gatewayEnvSchema),
    SharedLoggingModule.forRoot(),
    RateLimitModule,
    JwtVerificationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
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
  controllers: [
    HealthController,
    KeycloakSessionController,
    CatalogProxyController,
    OrderProxyController,
    SearchProxyController,
    DeliveryProxyController,
    MediaProxyController,
    ConfigProxyController,
    ReviewProxyController,
    AnalyticsProxyController,
    AuthProxyController,
  ],
  providers: [
    CircuitBreakerRegistry,
    HttpForwarder,
    KeycloakOidcClient,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
