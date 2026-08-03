import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Converts `orders` to a monthly RANGE-partitioned table on `created_at`, on
 * top of the existing populated table. Postgres cannot `ALTER TABLE ... SET
 * PARTITION BY` in place, so this is a create-copy-swap: build the partitioned
 * replacement alongside the original, copy every row across with an explicit
 * column list, verify the row count matches, then swap the names. Every step
 * is guarded (`IF EXISTS`/`IF NOT EXISTS`, an explicit count assertion) and
 * the whole migration runs in one transaction (TypeORM's default), so any
 * failure rolls back to the untouched original table — never a half-migrated
 * state.
 *
 * Postgres also requires the partition key to be part of every unique
 * constraint on a partitioned table, so the PK becomes composite
 * `(created_at, id)` (partition key first — the common access pattern is
 * tenant+time-scoped, and `id` is still unique in practice as a UUID). A bare
 * `WHERE id = ?` now scans every partition; acceptable since the hot paths
 * are tenant+time-scoped and there is no such lookup on the order hot path
 * today.
 *
 * `order_items.order_id → orders(id)` is dropped rather than carried forward:
 * a partitioned table's PK can only be FK-referenced together with its
 * partition key, which would force `order_items` to denormalize
 * `order_created_at` and partition too. Instead the Order aggregate is the
 * integrity boundary — `order_items` rows are only ever created/loaded
 * together with their order, and orders are never hard-deleted (terminal
 * states only), so no cascade ever needed to fire. The `order_id` column and
 * its index are unaffected.
 */
export class PartitionOrdersByMonth1753748200000 implements MigrationInterface {
  name = 'PartitionOrdersByMonth1753748200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Build the partitioned replacement with the FULL current column set
    //    (base + the pricing breakdown + restaurant_id columns added by
    //    later migrations) and the partition key folded into the PK, as
    //    Postgres requires for RANGE partitioning.
    await queryRunner.query(`
      CREATE TABLE "orders_partitioned" (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "restaurant_id" uuid,
        "status" varchar(20) NOT NULL,
        "subtotal_cents" integer NOT NULL,
        "delivery_fee_cents" integer NOT NULL,
        "vat_cents" integer NOT NULL,
        "discount_cents" integer NOT NULL,
        "total_cents" integer NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_orders_total_cents_non_negative" CHECK ("total_cents" >= 0),
        CONSTRAINT "chk_orders_subtotal_cents_non_negative" CHECK ("subtotal_cents" >= 0),
        CONSTRAINT "chk_orders_delivery_fee_cents_non_negative" CHECK ("delivery_fee_cents" >= 0),
        CONSTRAINT "chk_orders_vat_cents_non_negative" CHECK ("vat_cents" >= 0),
        CONSTRAINT "chk_orders_discount_cents_non_negative" CHECK ("discount_cents" >= 0),
        CONSTRAINT "pk_orders" PRIMARY KEY ("created_at", "id")
      ) PARTITION BY RANGE ("created_at")
    `);

    // 2. Monthly partitions from the oldest existing row's month through one
    //    month past the current month — computed from the LIVE data (not a
    //    hardcoded range) so this works regardless of how far back `orders`
    //    actually goes. Falls back to the current month when `orders` is
    //    empty (fresh/test databases).
    await queryRunner.query(`
      DO $$
      DECLARE
        start_month timestamptz;
        end_month_exclusive timestamptz;
        cur timestamptz;
        partition_name text;
      BEGIN
        SELECT date_trunc('month', COALESCE(MIN("created_at"), now())) INTO start_month FROM "orders";
        SELECT date_trunc('month', GREATEST(COALESCE(MAX("created_at"), now()), now())) + interval '2 months'
          INTO end_month_exclusive FROM "orders";

        cur := start_month;
        WHILE cur < end_month_exclusive LOOP
          partition_name := 'orders_p' || to_char(cur, 'YYYYMM');
          EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF "orders_partitioned" FOR VALUES FROM (%L) TO (%L)',
            partition_name, cur, cur + interval '1 month'
          );
          cur := cur + interval '1 month';
        END LOOP;
      END $$;
    `);

    // DEFAULT partition: a safety net for any row whose created_at falls
    // outside the generated monthly ranges above (should never happen given
    // the min/max-driven loop, but a partitioned table with no DEFAULT
    // rejects the copy outright for any out-of-range row instead of erroring
    // loudly at a specific, debuggable row).
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS "orders_default" PARTITION OF "orders_partitioned" DEFAULT',
    );

    // 3. Copy every existing row across — explicit column lists on both
    //    sides (never SELECT *) so a future column reorder can never
    //    silently misalign the copy.
    await queryRunner.query(`
      INSERT INTO "orders_partitioned"
        ("id","tenant_id","user_id","restaurant_id","status","subtotal_cents","delivery_fee_cents","vat_cents","discount_cents","total_cents","version","created_at","updated_at")
      SELECT
        "id","tenant_id","user_id","restaurant_id","status","subtotal_cents","delivery_fee_cents","vat_cents","discount_cents","total_cents","version","created_at","updated_at"
      FROM "orders"
    `);

    // 4. Row-count parity guard — abort (rolling back the whole migration
    //    transaction) rather than swap in a table that silently lost or
    //    duplicated rows.
    await queryRunner.query(`
      DO $$
      DECLARE
        orders_count bigint;
        partitioned_count bigint;
      BEGIN
        SELECT count(*) INTO orders_count FROM "orders";
        SELECT count(*) INTO partitioned_count FROM "orders_partitioned";
        IF orders_count <> partitioned_count THEN
          RAISE EXCEPTION 'orders row-count mismatch after partition copy: orders=%, orders_partitioned=%',
            orders_count, partitioned_count;
        END IF;
      END $$;
    `);

    // 5. Drop the order_items FK (see class doc for the trade-off). Looked
    //    up dynamically since the original migration let Postgres
    //    auto-name the constraint.
    await queryRunner.query(`
      DO $$
      DECLARE
        fk_name text;
      BEGIN
        SELECT tc.constraint_name INTO fk_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.table_name = 'order_items'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'order_id';

        IF fk_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE "order_items" DROP CONSTRAINT %I', fk_name);
        END IF;
      END $$;
    `);

    // 6. Swap the tables, then drop the old plain table LAST so the rename
    //    frees "idx_orders_tenant_id"/"idx_orders_tenant_user" (index names
    //    are unique per schema, not per table — they stay attached to
    //    "orders_legacy" after the rename) before they're re-created below.
    await queryRunner.query('ALTER TABLE "orders" RENAME TO "orders_legacy"');
    await queryRunner.query('ALTER TABLE "orders_partitioned" RENAME TO "orders"');
    await queryRunner.query('DROP TABLE "orders_legacy"');

    await queryRunner.query('CREATE INDEX "idx_orders_tenant_id" ON "orders" ("tenant_id")');
    await queryRunner.query(
      'CREATE INDEX "idx_orders_tenant_user" ON "orders" ("tenant_id", "user_id")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Build a plain (non-partitioned) replacement with the same full
    //    column set and CHECKs, PK back on `id` alone.
    await queryRunner.query(`
      CREATE TABLE "orders_unpartitioned" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "restaurant_id" uuid,
        "status" varchar(20) NOT NULL,
        "subtotal_cents" integer NOT NULL,
        "delivery_fee_cents" integer NOT NULL,
        "vat_cents" integer NOT NULL,
        "discount_cents" integer NOT NULL,
        "total_cents" integer NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_orders_total_cents_non_negative" CHECK ("total_cents" >= 0),
        CONSTRAINT "chk_orders_subtotal_cents_non_negative" CHECK ("subtotal_cents" >= 0),
        CONSTRAINT "chk_orders_delivery_fee_cents_non_negative" CHECK ("delivery_fee_cents" >= 0),
        CONSTRAINT "chk_orders_vat_cents_non_negative" CHECK ("vat_cents" >= 0),
        CONSTRAINT "chk_orders_discount_cents_non_negative" CHECK ("discount_cents" >= 0)
      )
    `);

    // 2. Copy every row back — explicit columns, never SELECT *.
    await queryRunner.query(`
      INSERT INTO "orders_unpartitioned"
        ("id","tenant_id","user_id","restaurant_id","status","subtotal_cents","delivery_fee_cents","vat_cents","discount_cents","total_cents","version","created_at","updated_at")
      SELECT
        "id","tenant_id","user_id","restaurant_id","status","subtotal_cents","delivery_fee_cents","vat_cents","discount_cents","total_cents","version","created_at","updated_at"
      FROM "orders"
    `);

    // 3. Row-count parity guard before touching anything irreversible.
    await queryRunner.query(`
      DO $$
      DECLARE
        partitioned_count bigint;
        restored_count bigint;
      BEGIN
        SELECT count(*) INTO partitioned_count FROM "orders";
        SELECT count(*) INTO restored_count FROM "orders_unpartitioned";
        IF partitioned_count <> restored_count THEN
          RAISE EXCEPTION 'orders row-count mismatch while reverting partitioning: orders=%, orders_unpartitioned=%',
            partitioned_count, restored_count;
        END IF;
      END $$;
    `);

    // 4. Swap: rename the partitioned table out of the way, promote the
    //    plain table, then drop the (now-orphaned) partitioned parent —
    //    which drops every attached partition, including the DEFAULT, with
    //    it (no CASCADE needed for a table's own partitions, but included
    //    for defence).
    await queryRunner.query('ALTER TABLE "orders" RENAME TO "orders_partitioned_old"');
    await queryRunner.query('ALTER TABLE "orders_unpartitioned" RENAME TO "orders"');
    await queryRunner.query('DROP TABLE "orders_partitioned_old" CASCADE');

    // 5. Restore the non-PK indexes.
    await queryRunner.query('CREATE INDEX "idx_orders_tenant_id" ON "orders" ("tenant_id")');
    await queryRunner.query(
      'CREATE INDEX "idx_orders_tenant_user" ON "orders" ("tenant_id", "user_id")',
    );

    // 6. Restore the order_items → orders FK dropped in up(), naming it the
    //    way Postgres would have auto-named it originally.
    await queryRunner.query(`
      ALTER TABLE "order_items"
        ADD CONSTRAINT "order_items_order_id_fkey"
        FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE
    `);
  }
}
