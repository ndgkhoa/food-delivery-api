import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface SeedTenantRecord {
  id: string;
  slug: string;
  name: string;
}

export interface SeedUserRecord {
  keycloakUserId: string;
  tenantId: string;
  username: string;
  role: string;
}

export interface SeedMenuItemRecord {
  id: string;
  name: string;
}

export interface SeedRestaurantRecord {
  id: string;
  tenantId: string;
  name: string;
  menuItems: SeedMenuItemRecord[];
}

export interface SeedConfigValueRecord {
  key: string;
  tenantId: string;
}

export interface SeedStockRecord {
  tenantId: string;
  itemId: string;
}

export interface SeedOrderRecord {
  id: string;
  tenantId: string;
}

/** One online driver GEO position pushed straight into Redis — see `redis-driver-geo.ts`. */
export interface SeedDriverLocationRecord {
  tenantId: string;
  driverId: string;
}

/** One media object uploaded through the real presigned-upload flow — see `seed-up-media.ts`. */
export interface SeedMediaRecord {
  id: string;
  tenantId: string;
  objectKey: string;
}

/** One review submitted for a confirmed demo order — see `seed-up-reviews.ts`. */
export interface SeedReviewRecord {
  id: string;
  tenantId: string;
}

/** One order row inserted directly into the order DB (backdated `created_at`) for the partitioning demo — see `seed-up-scenario-partitioning.ts`. Its `order_items` row is deleted alongside it, never tracked separately. */
export interface SeedPartitionDemoOrderRecord {
  id: string;
  tenantId: string;
}

/** One monthly `orders` partition CREATEd by the partitioning demo — only partitions this seeder actually created are recorded, so `seed:down` never drops one it didn't make. */
export interface SeedPartitionRecord {
  partitionName: string;
}

export interface SeedState {
  createdAt: string;
  tenants: SeedTenantRecord[];
  users: SeedUserRecord[];
  restaurants: SeedRestaurantRecord[];
  configValues: SeedConfigValueRecord[];
  stock: SeedStockRecord[];
  orders: SeedOrderRecord[];
  driverLocations: SeedDriverLocationRecord[];
  media: SeedMediaRecord[];
  reviews: SeedReviewRecord[];
  partitionDemoOrders: SeedPartitionDemoOrderRecord[];
  partitionsCreated: SeedPartitionRecord[];
}

export const SEED_STATE_PATH = path.resolve(__dirname, '.seed-state.json');

export function createEmptyState(): SeedState {
  return {
    createdAt: new Date().toISOString(),
    tenants: [],
    users: [],
    restaurants: [],
    configValues: [],
    stock: [],
    orders: [],
    driverLocations: [],
    media: [],
    reviews: [],
    partitionDemoOrders: [],
    partitionsCreated: [],
  };
}

/** Returns `null` (never throws) when no state file exists — `down` treats that as "nothing to do". */
export async function loadState(): Promise<SeedState | null> {
  try {
    const raw = await readFile(SEED_STATE_PATH, 'utf8');
    // Merge over an empty state so a file written by an OLDER seeder (before a
    // new array field existed) never leaves that field `undefined` and crashes
    // teardown — missing arrays default to [].
    return { ...createEmptyState(), ...(JSON.parse(raw) as Partial<SeedState>) } as SeedState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** Overwrites the state file — called after every major step of `up` so a mid-run failure never loses already-created ids. */
export async function saveState(state: SeedState): Promise<void> {
  await writeFile(SEED_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function removeState(): Promise<void> {
  await unlink(SEED_STATE_PATH);
}
