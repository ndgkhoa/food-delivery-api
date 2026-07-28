export interface ChargeDecision {
  ok: boolean;
  reason?: string;
}

/**
 * Deterministic stub charge rule: an order total that exactly matches the
 * configured trigger is DECLINED; every other amount is approved. No
 * randomness, so a saga compensation path can be exercised reliably. The real
 * payment provider (Temporal workflow + DLQ) replaces this later.
 */
export function decideCharge(totalCents: number, failAtCents: number): ChargeDecision {
  if (totalCents === failAtCents) {
    return { ok: false, reason: `payment declined for amount ${totalCents}` };
  }
  return { ok: true };
}
