export interface ChargeDecision {
  ok: boolean;
  reason?: string;
}

export function decideCharge(totalCents: number, failAtCents: number): ChargeDecision {
  if (totalCents === failAtCents) {
    return { ok: false, reason: `payment declined for amount ${totalCents}` };
  }
  return { ok: true };
}
