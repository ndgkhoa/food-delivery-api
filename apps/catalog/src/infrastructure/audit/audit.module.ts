import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AUDIT_PORT } from '../../domain/shared/audit.port';
import { AuditLogOrmEntity } from '../persistence/entities/audit-log.orm-entity';
import { TypeOrmAuditAdapter } from './typeorm-audit.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLogOrmEntity])],
  providers: [{ provide: AUDIT_PORT, useClass: TypeOrmAuditAdapter }],
  exports: [AUDIT_PORT],
})
export class AuditModule {}
