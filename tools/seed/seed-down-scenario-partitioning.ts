import { describeError } from './gateway-api-client';
import { deleteBackdatedOrder, dropMonthPartition, withOrderDb } from './order-db';
import type { SeedConfig } from './seed-config';
import type { SeedState } from './seed-state-store';

/** Direct-DB carve-out teardown for the order-partitioning scenario (see `seed-up-scenario-partitioning.ts` / `order-db.ts`) — deletes exactly the backdated order rows this seeder inserted, `order_items` first. Never a table-wide delete. */
export async function deletePartitionDemoOrders(
  config: SeedConfig,
  state: SeedState,
): Promise<void> {
  console.log(
    `\n[8/9] Deleting ${state.partitionDemoOrders.length} backdated partition-demo order(s)...`,
  );
  await withOrderDb(config, async (client) => {
    for (const order of state.partitionDemoOrders) {
      try {
        await deleteBackdatedOrder(client, order.id);
      } catch (error) {
        console.warn(`  ! could not delete backdated order ${order.id}: ${describeError(error)}`);
      }
    }
  });
}

/** Drops only the monthly `orders` partitions the partitioning scenario itself created this run — never the DEFAULT partition or a month it merely reused. */
export async function dropPartitionsCreated(config: SeedConfig, state: SeedState): Promise<void> {
  console.log(
    `\n[9/9] Dropping ${state.partitionsCreated.length} order partition(s) created for the demo...`,
  );
  await withOrderDb(config, async (client) => {
    for (const partition of state.partitionsCreated) {
      try {
        await dropMonthPartition(client, partition.partitionName);
        console.log(`  dropped ${partition.partitionName}`);
      } catch (error) {
        console.warn(
          `  ! could not drop partition ${partition.partitionName}: ${describeError(error)}`,
        );
      }
    }
  });
}
