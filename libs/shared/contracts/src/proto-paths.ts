import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolves the absolute path to a `.proto` file that ships beside this lib.
 *
 * We deliberately load protos at runtime via `@grpc/proto-loader` (NestJS's
 * gRPC transport) rather than generating TS stubs with ts-proto — that keeps
 * the toolchain free of a `protoc` binary and sidesteps ts-proto's ESM/CJS
 * interop friction under webpack + ts-jest. The trade-off is that `__dirname`
 * differs between the TS source layout (ts-jest / tsx) and the webpack bundle,
 * so we probe the known candidate locations and return the first that exists:
 *
 *  1. source layout — `libs/shared/contracts/proto` (ts-jest, tsx migrations).
 *  2. bundled asset — `<app-dist>/proto` (webpack copies protos here; see each
 *     app's webpack.config.js `assets`).
 *  3. repo-root fallback — for anything launched from the workspace root.
 *
 * Resolution is lazy (a function, not a top-level const) so importing the type
 * definitions never touches the filesystem.
 */
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

/**
 * Shared `@grpc/proto-loader` options — used by every server AND client so both
 * ends agree on wire↔object mapping. `keepCase: false` gives camelCase fields;
 * `defaults: true` + `arrays: true` make an absent proto3 repeated field
 * deserialize as `[]` (not `undefined`) — without them, an empty `items` list is
 * dropped on the wire and the client sees `undefined`, breaking length checks.
 */
export const PROTO_LOADER_OPTIONS = {
  keepCase: false,
  defaults: true,
  arrays: true,
  objects: true,
} as const;

/** gRPC package names (must match `package` in the `.proto` files). */
export const CATALOG_GRPC_PACKAGE = 'catalog';
export const INVENTORY_GRPC_PACKAGE = 'inventory';

/** Service names as declared in the protos — used by `@GrpcMethod` decorators. */
export const CATALOG_SERVICE_NAME = 'CatalogService';
export const INVENTORY_SERVICE_NAME = 'InventoryService';

/**
 * Metadata key carrying the verified tenant across a gRPC call. Mirrors the
 * HTTP `x-tenant-id` trusted-identity header so both transports agree.
 */
export const GRPC_TENANT_ID_METADATA = 'x-tenant-id';
