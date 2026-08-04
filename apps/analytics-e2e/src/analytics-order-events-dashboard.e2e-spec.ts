import { randomUUID } from 'node:crypto';
import {
  fetchRevenue,
  fetchSummary,
  fetchTopRestaurants,
  pollSummaryUntil,
} from './support/dashboard-poll';
import {
  ORDER_CANCELLED,
  produceOrderLifecycleEvent,
} from './support/order-lifecycle-event-producer';

const gatedDescribe = process.env.RUN_ANALYTICS_E2E === '1' ? describe : describe.skip;

const TENANT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_TENANT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const FROM = '2020-01-01T00:00:00.000Z';
const TO = '2030-01-01T00:00:00.000Z';

gatedDescribe('analytics order.events ingest + dashboards (e2e)', () => {
  it('reflects produced CONFIRMED/CANCELLED orders in revenue, summary, and top-restaurants', async () => {
    const restaurantId = randomUUID();
    const confirmedOrderId = randomUUID();
    const cancelledOrderId = randomUUID();

    await produceOrderLifecycleEvent({
      orderId: confirmedOrderId,
      userId: randomUUID(),
      tenantId: TENANT,
      totalCents: 4_200,
      restaurantId,
    });
    await produceOrderLifecycleEvent({
      orderId: cancelledOrderId,
      userId: randomUUID(),
      tenantId: TENANT,
      totalCents: 1_000,
      eventType: ORDER_CANCELLED,
    });

    const summary = await pollSummaryUntil(
      TENANT,
      FROM,
      TO,
      (current) => current.confirmedCount >= 1 && current.cancelledCount >= 1,
    );
    expect(summary.revenueCents).toBeGreaterThanOrEqual(4_200);

    const revenue = await fetchRevenue(TENANT, FROM, TO);
    const totalRevenue = revenue.reduce((sum, point) => sum + point.revenueCents, 0);
    expect(totalRevenue).toBeGreaterThanOrEqual(4_200);

    const topRestaurants = await fetchTopRestaurants(TENANT, FROM, TO);
    const entry = topRestaurants.find((row) => row.restaurantId === restaurantId);
    expect(entry).toEqual({ restaurantId, revenueCents: 4_200, orderCount: 1 });
  });

  it('does not double revenue on a genuine redelivery (ReplacingMergeTree + FINAL)', async () => {
    const orderId = randomUUID();
    const eventId = randomUUID();
    const before = await fetchSummary(TENANT, FROM, TO);

    await produceOrderLifecycleEvent({
      orderId,
      userId: randomUUID(),
      tenantId: TENANT,
      totalCents: 900,
      eventId,
    });
    await produceOrderLifecycleEvent({
      orderId,
      userId: randomUUID(),
      tenantId: TENANT,
      totalCents: 900,
      eventId, // same eventId + orderId — a genuine redelivery, not a new order.
    });

    const after = await pollSummaryUntil(
      TENANT,
      FROM,
      TO,
      (current) => current.revenueCents >= before.revenueCents + 900,
    );
    expect(after.revenueCents).toBe(before.revenueCents + 900);
    expect(after.confirmedCount).toBe(before.confirmedCount + 1);
  });

  it("never leaks another tenant's orders into the caller's dashboard", async () => {
    const otherOrderId = randomUUID();
    const before = await fetchSummary(TENANT, FROM, TO);

    await produceOrderLifecycleEvent({
      orderId: otherOrderId,
      userId: randomUUID(),
      tenantId: OTHER_TENANT,
      totalCents: 50_000,
    });
    await pollSummaryUntil(OTHER_TENANT, FROM, TO, (current) => current.confirmedCount >= 1);

    const callerSummary = await fetchSummary(TENANT, FROM, TO);
    expect(callerSummary.revenueCents).toBe(before.revenueCents);
    expect(callerSummary.confirmedCount).toBe(before.confirmedCount);
  });
});
