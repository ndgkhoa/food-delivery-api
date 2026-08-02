import { CreateTenantHandler } from '@auth/application/tenant/commands/create-tenant.handler';
import { ProvisionUserHandler } from '@auth/application/tenant/commands/provision-user.handler';
import { GetTenantHandler } from '@auth/application/tenant/queries/get-tenant.handler';
import { ListTenantsHandler } from '@auth/application/tenant/queries/list-tenants.handler';
import { authEnvSchema } from '@auth/config/auth-env-schema';
import { KeycloakModule } from '@auth/infrastructure/keycloak/keycloak.module';
import { PersistenceModule } from '@auth/infrastructure/persistence/persistence.module';
import { DomainErrorFilter } from '@auth/interface/http/filters/domain-error.filter';
import { TenantsController } from '@auth/interface/http/tenants.controller';
import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { HealthModule } from '@food-delivery-api/shared-health';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { RolesGuard } from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

/**
 * Composition root: wires ports (domain) to adapters (infrastructure), registers
 * application use-case handlers, and registers HTTP controllers (interface).
 * The only file allowed to import across all layers — see the dependency-cruiser
 * layer rules in `.dependency-cruiser.js`.
 *
 * The registry admin API is platform-scoped (not caller-tenant-scoped), so it
 * does NOT wire the tenancy interceptor — only `RolesGuard`, which reads the
 * gateway-stamped `x-roles`/`x-user-id` headers to enforce `@Roles('admin')`.
 */
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
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
