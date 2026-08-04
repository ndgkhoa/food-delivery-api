import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthTables1753660800000 implements MigrationInterface {
  name = 'CreateAuthTables1753660800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await queryRunner.query(`
      CREATE TABLE "tenants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "slug" varchar(255) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "idx_tenants_slug" ON "tenants" ("slug")');

    await queryRunner.query(`
      CREATE TABLE "user_tenant_map" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "keycloak_user_id" varchar(255) NOT NULL,
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "role" varchar(50) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "idx_user_tenant_map_keycloak_user_id" ON "user_tenant_map" ("keycloak_user_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_user_tenant_map_tenant_id" ON "user_tenant_map" ("tenant_id")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "user_tenant_map"');
    await queryRunner.query('DROP TABLE IF EXISTS "tenants"');
  }
}
