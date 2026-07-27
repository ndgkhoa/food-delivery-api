import { KEYCLOAK_ADMIN_PORT } from '@auth/domain/keycloak/keycloak-admin.port';
import { KeycloakAdminHttpAdapter } from '@auth/infrastructure/keycloak/keycloak-admin-http.adapter';
import { Module } from '@nestjs/common';

/** Binds the domain `KEYCLOAK_ADMIN_PORT` to the fetch-based Admin REST adapter. */
@Module({
  providers: [{ provide: KEYCLOAK_ADMIN_PORT, useClass: KeycloakAdminHttpAdapter }],
  exports: [KEYCLOAK_ADMIN_PORT],
})
export class KeycloakModule {}
