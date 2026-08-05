import { decideCharge } from '@payment/application/charge/charge-decision';

describe('decideCharge (deterministic stub)', () => {
  it('declines exactly the configured trigger amount', () => {
    const decision = decideCharge(66600, 66600);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain('66600');
  });

  it('approves any amount below the trigger', () => {
    expect(decideCharge(1000, 66600)).toEqual({ ok: true });
  });

  it('approves any amount above the trigger', () => {
    expect(decideCharge(70000, 66600)).toEqual({ ok: true });
  });

  it('is deterministic — same input always yields the same decision', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(decideCharge(66600, 66600).ok).toBe(false);
      expect(decideCharge(500, 66600).ok).toBe(true);
    }
  });
});
