import { GetTopRestaurantsHandler } from '@analytics/application/queries/get-top-restaurants.handler';
import { TOP_RESTAURANTS_QUERY } from '@analytics/domain/analytics-query/top-restaurants-query.port';
import { TENANT_CONTEXT_PORT } from '@food-delivery-api/shared-tenancy';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

describe('GetTopRestaurantsHandler', () => {
  const query = jest
    .fn()
    .mockResolvedValue([{ restaurantId: 'restaurant-1', revenueCents: 5000, orderCount: 10 }]);
  const getTenantIdOrThrow = jest.fn().mockReturnValue('tenant-1');

  beforeEach(() => {
    query.mockClear();
    getTenantIdOrThrow.mockClear();
  });

  async function buildHandler(): Promise<GetTopRestaurantsHandler> {
    const module = await Test.createTestingModule({
      providers: [
        GetTopRestaurantsHandler,
        { provide: TOP_RESTAURANTS_QUERY, useValue: { query } },
        { provide: TENANT_CONTEXT_PORT, useValue: { getTenantIdOrThrow } },
      ],
    }).compile();
    return module.get(GetTopRestaurantsHandler);
  }

  it('delegates to the query port with the verified tenant, parsed range, and limit', async () => {
    const handler = await buildHandler();
    const result = await handler.execute({ from: '2026-01-01', to: '2026-01-31', limit: 5 });

    expect(result).toEqual([{ restaurantId: 'restaurant-1', revenueCents: 5000, orderCount: 10 }]);
    expect(query).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      range: { from: new Date('2026-01-01'), to: new Date('2026-01-31') },
      limit: 5,
    });
  });

  it('rejects an inverted range with a 400 before ever reaching the query port', async () => {
    const handler = await buildHandler();
    await expect(
      handler.execute({ from: '2026-01-31', to: '2026-01-01', limit: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });
});
