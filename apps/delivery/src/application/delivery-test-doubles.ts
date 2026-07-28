import type { Assignment } from '@delivery/domain/delivery/assignment';
import type { AssignmentClaim, AssignmentStore } from '@delivery/domain/delivery/assignment.store';
import type { DriverLocationStore } from '@delivery/domain/delivery/driver-location.store';
import type { Location } from '@delivery/domain/delivery/location';
import type { NearbyDriver } from '@delivery/domain/delivery/nearby-driver';

export const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** In-memory driver-location store mirroring the tenant-scoped Redis GEO adapter. */
export class FakeDriverLocationStore implements DriverLocationStore {
  private readonly online = new Map<string, string[]>();
  private readonly near = new Map<string, NearbyDriver[]>();
  readonly pushed: Array<{ tenantId: string; driverId: string; location: Location }> = [];

  seedOnline(tenantId: string, driverIds: string[]): void {
    this.online.set(tenantId, driverIds);
  }

  seedNearby(tenantId: string, drivers: NearbyDriver[]): void {
    this.near.set(tenantId, drivers);
  }

  async push(tenantId: string, driverId: string, location: Location): Promise<void> {
    this.pushed.push({ tenantId, driverId, location });
  }

  async remove(tenantId: string, driverId: string): Promise<void> {
    this.online.set(
      tenantId,
      (this.online.get(tenantId) ?? []).filter((id) => id !== driverId),
    );
  }

  async nearby(tenantId: string, _origin: Location, radiusMeters: number): Promise<NearbyDriver[]> {
    return (this.near.get(tenantId) ?? []).filter((d) => d.distanceMeters <= radiusMeters);
  }

  async onlineDriverIds(tenantId: string): Promise<string[]> {
    return this.online.get(tenantId) ?? [];
  }
}

/**
 * In-memory assignment store mirroring the Lua adapter's atomic semantics: an
 * already-assigned order returns its incumbent, otherwise the first candidate
 * NOT already busy is bound (one driver per order AND one order per driver).
 */
export class FakeAssignmentStore implements AssignmentStore {
  private readonly byOrder = new Map<string, string>();
  private readonly busy = new Map<string, Set<string>>();
  private readonly driverOrders = new Map<string, Set<string>>();

  private orderKey(tenantId: string, orderId: string): string {
    return `${tenantId}:${orderId}`;
  }

  async assign(
    tenantId: string,
    orderId: string,
    candidateDriverIdsNearestFirst: string[],
  ): Promise<AssignmentClaim | undefined> {
    const key = this.orderKey(tenantId, orderId);
    const incumbent = this.byOrder.get(key);
    if (incumbent) {
      return { assignment: { orderId, driverId: incumbent }, created: false };
    }
    const busy = this.busy.get(tenantId) ?? new Set<string>();
    const driverId = candidateDriverIdsNearestFirst.find((id) => !busy.has(id));
    if (!driverId) {
      return undefined;
    }
    this.byOrder.set(key, driverId);
    this.addTo(this.busy, tenantId, driverId);
    this.addTo(this.driverOrders, `${tenantId}:${driverId}`, orderId);
    return { assignment: { orderId, driverId }, created: true };
  }

  async unassign(tenantId: string, orderId: string): Promise<void> {
    const key = this.orderKey(tenantId, orderId);
    const driverId = this.byOrder.get(key);
    if (!driverId) {
      return;
    }
    this.byOrder.delete(key);
    const orders = this.driverOrders.get(`${tenantId}:${driverId}`);
    orders?.delete(orderId);
    if (!orders || orders.size === 0) {
      this.busy.get(tenantId)?.delete(driverId);
    }
  }

  async get(tenantId: string, orderId: string): Promise<Assignment | undefined> {
    const driverId = this.byOrder.get(this.orderKey(tenantId, orderId));
    return driverId ? { orderId, driverId } : undefined;
  }

  async ordersForDriver(tenantId: string, driverId: string): Promise<string[]> {
    return [...(this.driverOrders.get(`${tenantId}:${driverId}`) ?? [])];
  }

  private addTo(map: Map<string, Set<string>>, key: string, value: string): void {
    const set = map.get(key) ?? new Set<string>();
    set.add(value);
    map.set(key, set);
  }
}
