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

export interface SeedDriverLocationRecord {
  tenantId: string;
  driverId: string;
}

export interface SeedMediaRecord {
  id: string;
  tenantId: string;
  objectKey: string;
}

export interface SeedReviewRecord {
  id: string;
  tenantId: string;
}

export interface SeedPartitionDemoOrderRecord {
  id: string;
  tenantId: string;
}

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

export async function loadState(): Promise<SeedState | null> {
  try {
    const raw = await readFile(SEED_STATE_PATH, 'utf8');
    return { ...createEmptyState(), ...(JSON.parse(raw) as Partial<SeedState>) } as SeedState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function saveState(state: SeedState): Promise<void> {
  await writeFile(SEED_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function removeState(): Promise<void> {
  await unlink(SEED_STATE_PATH);
}
