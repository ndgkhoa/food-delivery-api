import { GetSummaryHandler } from '@analytics/application/queries/get-summary.handler';
import { SUMMARY_QUERY } from '@analytics/domain/analytics-query/summary-query.port';
import { TENANT_CONTEXT_PORT } from '@food-delivery-api/shared-tenancy';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

describe('GetSummaryHandler', () => {
  const query = jest
    .fn()
    .mockResolvedValue({ revenueCents: 10_000, confirmedCount: 4, cancelledCount: 1 });
  const getTenantIdOrThrow = jest.fn().mockReturnValue('tenant-1');

  beforeEach(() => {
    query.mockClear();
    getTenantIdOrThrow.mockClear();
  });

  async function buildHandler(): Promise<GetSummaryHandler> {
    const module = await Test.createTestingModule({
      providers: [
        GetSummaryHandler,
        { provide: SUMMARY_QUERY, useValue: { query } },
        { provide: TENANT_CONTEXT_PORT, useValue: { getTenantIdOrThrow } },
      ],
    }).compile();
    return module.get(GetSummaryHandler);
  }

  it('delegates to the query port with the verified tenant and parsed range', async () => {
    const handler = await buildHandler();
    const result = await handler.execute({ from: '2026-01-01', to: '2026-01-31' });

    expect(result).toEqual({ revenueCents: 10_000, confirmedCount: 4, cancelledCount: 1 });
    expect(query).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      range: { from: new Date('2026-01-01'), to: new Date('2026-01-31') },
    });
  });

  it('rejects an unparsable date with a 400 before ever reaching the query port', async () => {
    const handler = await buildHandler();
    await expect(handler.execute({ from: 'not-a-date', to: '2026-01-31' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
