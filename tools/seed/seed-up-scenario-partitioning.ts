import { randomUUID } from 'node:crypto';
import {
  computeMonthPartitionRange,
  createMonthPartition,
  insertBackdatedOrder,
  partitionExists,
  withOrderDb,
} from './order-db';
import type { SeedConfig } from './seed-config';
import type { SeedState } from './seed-state-store';

const PAST_MONTH_OFFSETS = [-1, -2];
const ORDERS_PER_PAST_MONTH = 2;

export async function runPartitioningScenario(
  config: SeedConfig,
  state: SeedState,
  tenantId: string,
  userId: string,
  restaurantId: string,
  itemId: string,
): Promise<void> {
  console.log(
    `\n[scenario] order partitioning — backdating orders into ${PAST_MONTH_OFFSETS.length} past month(s)...`,
  );
  const now = new Date();

  await withOrderDb(config, async (client) => {
    for (const monthOffset of PAST_MONTH_OFFSETS) {
      const range = computeMonthPartitionRange(now, monthOffset);
      const alreadyExisted = await partitionExists(client, range.partitionName);
      if (!alreadyExisted) {
        await createMonthPartition(client, range);
        state.partitionsCreated.push({ partitionName: range.partitionName });
        console.log(
          `  created partition ${range.partitionName} [${range.fromDate}, ${range.toDateExclusive})`,
        );
      } else {
        console.log(
          `  partition ${range.partitionName} already existed — reusing, not tracked for teardown`,
        );
      }

      const monthStart = new Date(`${range.fromDate}T00:00:00.000Z`);
      for (let i = 0; i < ORDERS_PER_PAST_MONTH; i += 1) {
        const orderId = randomUUID();
        const createdAt = new Date(
          Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 10 + i * 5, 12, 0, 0),
        );
        await insertBackdatedOrder(client, {
          id: orderId,
          tenantId,
          userId,
          restaurantId,
          itemId,
          createdAt,
        });
        state.partitionDemoOrders.push({ id: orderId, tenantId });
      }
      console.log(
        `  inserted ${ORDERS_PER_PAST_MONTH} backdated order(s) into ${range.partitionName}`,
      );
    }
  });

  console.log(
    `  partitioning demo: orders now span ${PAST_MONTH_OFFSETS.length + 1}+ monthly partitions — ` +
      'run EXPLAIN on a date-filtered query to observe pruning (see README)',
  );
}
