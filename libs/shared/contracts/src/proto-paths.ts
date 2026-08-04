import { existsSync } from 'node:fs';
import { join } from 'node:path';

function resolveProtoPath(fileName: string): string {
  const candidates = [
    join(__dirname, '..', 'proto', fileName),
    join(__dirname, 'proto', fileName),
    join(process.cwd(), 'libs', 'shared', 'contracts', 'proto', fileName),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `proto file "${fileName}" not found — looked in:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
    );
  }
  return found;
}

export function catalogProtoPath(): string {
  return resolveProtoPath('catalog.proto');
}

export function inventoryProtoPath(): string {
  return resolveProtoPath('inventory.proto');
}

export const PROTO_LOADER_OPTIONS = {
  keepCase: false,
  defaults: true,
  arrays: true,
  objects: true,
} as const;

export const CATALOG_GRPC_PACKAGE = 'catalog';
export const INVENTORY_GRPC_PACKAGE = 'inventory';

export const CATALOG_SERVICE_NAME = 'CatalogService';
export const INVENTORY_SERVICE_NAME = 'InventoryService';

export const GRPC_TENANT_ID_METADATA = 'x-tenant-id';
