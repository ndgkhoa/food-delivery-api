import { decideCharge } from '@payment/application/charge/charge-decision';
import type { ChargeActivityInput, ProviderResult } from '@payment/workflows/charge-workflow.types';
import { log } from '@temporalio/activity';

export interface ChargeActivityDeps {
  failAtCents: number;
}

export function createChargeActivity(
  deps: ChargeActivityDeps,
): (input: ChargeActivityInput) => Promise<ProviderResult> {
  return async ({ totalCents }) => {
    const decision = decideCharge(totalCents, deps.failAtCents);
    log.info('charge decided', { totalCents, ok: decision.ok });
    return { ok: decision.ok, reason: decision.reason };
  };
}
