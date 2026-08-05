import { CreateTenantHandler } from '@auth/application/tenant/commands/create-tenant.handler';
import { ProvisionUserHandler } from '@auth/application/tenant/commands/provision-user.handler';
import { GetTenantHandler } from '@auth/application/tenant/queries/get-tenant.handler';
import { ListTenantsHandler } from '@auth/application/tenant/queries/list-tenants.handler';
import { authEnvSchema } from '@auth/config/auth-env-schema';
import { KeycloakModule } from '@auth/infrastructure/keycloak/keycloak.module';
import { PersistenceModule } from '@auth/infrastructure/persistence/persistence.module';
import { TenantsController } from '@auth/interface/http/tenants.controller';
import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { HealthModule } from '@food-delivery-api/shared-health';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { RolesGuard } from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    SharedConfigModule.forRoot(authEnvSchema),
    SharedLoggingModule.forRoot(),
    HealthModule,
    PersistenceModule,
    KeycloakModule,
  ],
  controllers: [TenantsController],
  providers: [
    CreateTenantHandler,
    ProvisionUserHandler,
    ListTenantsHandler,
    GetTenantHandler,
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
