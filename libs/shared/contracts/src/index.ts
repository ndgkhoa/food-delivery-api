export type {
  CatalogGrpcService,
  GetMenuItemsRequest,
  MenuItemMessage,
  MenuItemsResponse,
} from './catalog-contract.types';
export type {
  InventoryGrpcClient,
  InventoryGrpcService,
  ReleaseRequest,
  ReleaseResponse,
  ReserveItemMessage,
  ReserveRequest,
  ReserveResponse,
} from './inventory-contract.types';
export {
  CATALOG_GRPC_PACKAGE,
  CATALOG_SERVICE_NAME,
  catalogProtoPath,
  GRPC_TENANT_ID_METADATA,
  INVENTORY_GRPC_PACKAGE,
  INVENTORY_SERVICE_NAME,
  inventoryProtoPath,
  PROTO_LOADER_OPTIONS,
} from './proto-paths';
