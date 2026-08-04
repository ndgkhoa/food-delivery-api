import { KEYCLOAK_ADMIN_PORT } from '@auth/domain/keycloak/keycloak-admin.port';
import { KeycloakAdminHttpAdapter } from '@auth/infrastructure/keycloak/keycloak-admin-http.adapter';
import { Module } from '@nestjs/common';

@Module({
  providers: [{ provide: KEYCLOAK_ADMIN_PORT, useClass: KeycloakAdminHttpAdapter }],
  exports: [KEYCLOAK_ADMIN_PORT],
})
export class KeycloakModule {}
