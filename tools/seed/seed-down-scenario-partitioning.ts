import { describeError } from './gateway-api-client';
import { deleteBackdatedOrder, dropMonthPartition, withOrderDb } from './order-db';
import type { SeedConfig } from './seed-config';
import type { SeedState } from './seed-state-store';

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
