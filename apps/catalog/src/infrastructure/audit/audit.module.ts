import { AUDIT_PORT } from '@catalog/domain/shared/audit.port';
import { TypeOrmAuditAdapter } from '@catalog/infrastructure/audit/typeorm-audit.adapter';
import { AuditLogOrmEntity } from '@catalog/infrastructure/persistence/entities/audit-log.orm-entity';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLogOrmEntity])],
  providers: [{ provide: AUDIT_PORT, useClass: TypeOrmAuditAdapter }],
  exports: [AUDIT_PORT],
})
export class AuditModule {}
