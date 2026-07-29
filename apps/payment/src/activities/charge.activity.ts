import { decideCharge } from '@payment/application/charge/charge-decision';
import type { ChargeActivityInput, ProviderResult } from '@payment/workflows/charge-workflow.types';
import { log } from '@temporalio/activity';

/** Deps the charge activity closes over — config read here, never in the workflow. */
export interface ChargeActivityDeps {
  failAtCents: number;
}

/**
 * Builds the `charge` activity. This is the ONLY place the deterministic stub
 * rule + its config threshold run — the workflow stays pure. Temporal may retry
 * the activity, and `decideCharge` is a pure function of the total, so every
 * attempt reaches the same verdict (no double-charge divergence).
 */
export function createChargeActivity(
  deps: ChargeActivityDeps,
): (input: ChargeActivityInput) => Promise<ProviderResult> {
  return async ({ totalCents }) => {
    const decision = decideCharge(totalCents, deps.failAtCents);
    log.info('charge decided', { totalCents, ok: decision.ok });
    return { ok: decision.ok, reason: decision.reason };
  };
}
