import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexOrdersTenantUserCreated1753748300000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_orders_tenant_user_created" ' +
        'ON "orders" ("tenant_id", "user_id", "created_at" DESC)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_orders_tenant_user_created"');
  }
}
