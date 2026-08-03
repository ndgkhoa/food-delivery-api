import { GetRevenueSeriesHandler } from '@analytics/application/queries/get-revenue-series.handler';
import { REVENUE_SERIES_QUERY } from '@analytics/domain/analytics-query/revenue-series-query.port';
import { TENANT_CONTEXT_PORT } from '@food-delivery-api/shared-tenancy';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

describe('GetRevenueSeriesHandler', () => {
  const query = jest
    .fn()
    .mockResolvedValue([{ day: '2026-01-01', revenueCents: 1000, orderCount: 2 }]);
  const getTenantIdOrThrow = jest.fn().mockReturnValue('tenant-1');

  beforeEach(() => {
    query.mockClear();
    getTenantIdOrThrow.mockClear();
  });

  async function buildHandler(): Promise<GetRevenueSeriesHandler> {
    const module = await Test.createTestingModule({
      providers: [
        GetRevenueSeriesHandler,
        { provide: REVENUE_SERIES_QUERY, useValue: { query } },
        { provide: TENANT_CONTEXT_PORT, useValue: { getTenantIdOrThrow } },
      ],
    }).compile();
    return module.get(GetRevenueSeriesHandler);
  }

  it('delegates to the query port with the verified tenant and parsed range', async () => {
    const handler = await buildHandler();
    const result = await handler.execute({ from: '2026-01-01', to: '2026-01-31' });

    expect(result).toEqual([{ day: '2026-01-01', revenueCents: 1000, orderCount: 2 }]);
    expect(query).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      range: { from: new Date('2026-01-01'), to: new Date('2026-01-31') },
    });
  });

  it('rejects an inverted range with a 400 before ever reaching the query port', async () => {
    const handler = await buildHandler();
    await expect(handler.execute({ from: '2026-01-31', to: '2026-01-01' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
