import { loadSync } from '@grpc/proto-loader';
import { catalogProtoPath, inventoryProtoPath, PROTO_LOADER_OPTIONS } from './proto-paths';

describe('gRPC proto contracts', () => {
  it('loads the catalog contract with GetMenuItems', () => {
    const definition = loadSync(catalogProtoPath(), PROTO_LOADER_OPTIONS);
    expect(definition['catalog.CatalogService']).toBeDefined();
    expect(definition['catalog.GetMenuItemsRequest']).toBeDefined();
    expect(definition['catalog.MenuItemsResponse']).toBeDefined();
  });

  it('loads the inventory contract with Reserve and Release', () => {
    const definition = loadSync(inventoryProtoPath(), PROTO_LOADER_OPTIONS);
    expect(definition['inventory.InventoryService']).toBeDefined();
    expect(definition['inventory.ReserveRequest']).toBeDefined();
    expect(definition['inventory.ReserveResponse']).toBeDefined();
    expect(definition['inventory.ReleaseRequest']).toBeDefined();
    expect(definition['inventory.ReleaseResponse']).toBeDefined();
  });
});
