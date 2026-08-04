import {
  catalogProtoPath,
  type GetMenuItemsRequest,
  GRPC_TENANT_ID_METADATA,
  type MenuItemMessage,
  type MenuItemsResponse,
  PROTO_LOADER_OPTIONS,
} from '@food-delivery-api/shared-contracts';
import {
  loadPackageDefinition,
  Server,
  ServerCredentials,
  type ServerUnaryCall,
  type ServiceDefinition,
  type sendUnaryData,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';

export interface FakeCatalogGrpcServer {
  url: string;
  seed(tenantId: string, item: MenuItemMessage): void;
  stop(): Promise<void>;
}

function compositeKey(tenantId: string, itemId: string): string {
  return `${tenantId}:${itemId}`;
}

export async function startFakeCatalogGrpcServer(): Promise<FakeCatalogGrpcServer> {
  const items = new Map<string, MenuItemMessage>();

  const packageDefinition = loadSync(catalogProtoPath(), PROTO_LOADER_OPTIONS);
  const proto = loadPackageDefinition(packageDefinition) as unknown as {
    catalog: { CatalogService: { service: ServiceDefinition } };
  };

  const server = new Server({ 'grpc.max_concurrent_streams': 1000 });
  server.addService(proto.catalog.CatalogService.service, {
    getMenuItems: (
      call: ServerUnaryCall<GetMenuItemsRequest, MenuItemsResponse>,
      callback: sendUnaryData<MenuItemsResponse>,
    ) => {
      const tenantId = call.metadata.get(GRPC_TENANT_ID_METADATA)[0]?.toString() ?? '';
      const ids = call.request.ids ?? [];
      const found = ids
        .map((id) => items.get(compositeKey(tenantId, id)))
        .filter((item): item is MenuItemMessage => item !== undefined);
      callback(null, { items: found });
    },
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, boundPort) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(boundPort);
    });
  });

  return {
    url: `127.0.0.1:${port}`,
    seed: (tenantId, item) => items.set(compositeKey(tenantId, item.id), item),
    stop: () =>
      new Promise<void>((resolve) => {
        server.tryShutdown(() => resolve());
      }),
  };
}
