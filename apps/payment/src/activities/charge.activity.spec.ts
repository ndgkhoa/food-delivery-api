import { createChargeActivity } from './charge.activity';

// The activity calls @temporalio/activity's `log`, which needs an activity
// context. Stub it so the pure decision logic can be unit-tested standalone.
jest.mock('@temporalio/activity', () => ({ log: { info: jest.fn() } }));

describe('createChargeActivity', () => {
  const charge = createChargeActivity({ failAtCents: 66600 });

  it('declines exactly the configured trigger amount', async () => {
    const result = await charge({ totalCents: 66600 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('66600');
  });

  it('approves any other amount', async () => {
    expect(await charge({ totalCents: 1000 })).toEqual({ ok: true, reason: undefined });
  });

  it('is deterministic across repeated calls', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await charge({ totalCents: 66600 })).ok).toBe(false);
      expect((await charge({ totalCents: 500 })).ok).toBe(true);
    }
  });
});
