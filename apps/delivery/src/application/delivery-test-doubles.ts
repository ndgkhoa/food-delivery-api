import type { Assignment } from '@delivery/domain/delivery/assignment';
import type { AssignmentStore } from '@delivery/domain/delivery/assignment.store';
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

  async nearby(tenantId: string, _origin: Location, radiusMeters: number): Promise<NearbyDriver[]> {
    return (this.near.get(tenantId) ?? []).filter((d) => d.distanceMeters <= radiusMeters);
  }

  async onlineDriverIds(tenantId: string): Promise<string[]> {
    return this.online.get(tenantId) ?? [];
  }
}

/** In-memory assignment store with the same idempotent-assign semantics as HSETNX. */
export class FakeAssignmentStore implements AssignmentStore {
  private readonly byOrder = new Map<string, string>();
  private readonly busy = new Map<string, Set<string>>();
  private readonly driverOrders = new Map<string, Set<string>>();

  private orderKey(tenantId: string, orderId: string): string {
    return `${tenantId}:${orderId}`;
  }

  async assign(tenantId: string, orderId: string, driverId: string): Promise<Assignment> {
    const key = this.orderKey(tenantId, orderId);
    const existing = this.byOrder.get(key);
    if (existing) {
      return { orderId, driverId: existing };
    }
    this.byOrder.set(key, driverId);
    this.addTo(this.busy, tenantId, driverId);
    this.addTo(this.driverOrders, `${tenantId}:${driverId}`, orderId);
    return { orderId, driverId };
  }

  async get(tenantId: string, orderId: string): Promise<Assignment | undefined> {
    const driverId = this.byOrder.get(this.orderKey(tenantId, orderId));
    return driverId ? { orderId, driverId } : undefined;
  }

  async busyDriverIds(tenantId: string): Promise<string[]> {
    return [...(this.busy.get(tenantId) ?? [])];
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
