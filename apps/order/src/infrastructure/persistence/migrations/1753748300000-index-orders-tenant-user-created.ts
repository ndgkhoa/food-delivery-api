import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Composite index for the order-history read (`findRecentByTenant`:
 * `WHERE tenant_id AND user_id ORDER BY created_at DESC LIMIT n`). On the
 * monthly range-partitioned `orders` table, an index that carries `created_at`
 * lets each partition satisfy the filter + the ordered LIMIT from the index,
 * and a time-bounded variant can prune partitions — where the old
 * `(tenant_id, user_id)` index forced a full per-partition scan + sort. Created
 * on the partitioned parent, so Postgres propagates it to every partition.
 */
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
