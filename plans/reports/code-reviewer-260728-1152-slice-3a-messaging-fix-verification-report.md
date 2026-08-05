# Slice 3a Messaging — Fix Verification (28b6ffe..30d2093)

Verification pass on fixes for the prior red-team review. All findings CLOSED. No regressions, no new issues.

## Per-finding

- **C1 (Critical) — CLOSED.** `kafka-consumer.ts:116-152`. `decodeMessage` now runs inside a try/catch in `eachMessage`; on decode failure it logs + `commitPast()` + `return`s normally. The throw no longer escapes `eachMessage`, so the vendor's `eachMessageProcessed=true` path runs (no seek-back) AND we explicitly commit `offset+1` → the indefinite re-seek loop is genuinely eliminated. No-retry-on-decode is correct (retry can't add headers). Normal handler failure path unchanged (retry-then-swallow-then-commit). New e2e "skips an undecodable (header-less) message without stalling the partition" is a valid proof: single partition, poison at offset 0 before a valid message at offset 1, same key → same partition; asserts the valid message is delivered (would time out if stalled) and `received.length === 1` (poison skipped, not delivered). Solid.
  - Non-regression note: if `commitPast()` itself throws (rebalance), eachMessage throws → redeliver → decode fails → retry commit. Same transient-commit behavior as valid messages; not an infinite *decode* stall. Acceptable.

- **M2 — CLOSED.** `idempotent-consumer.ts:42,54`. `work: (tx: TTx) => Promise<TResult>` and `return work(tx)`; doc now mandates callers use the passed tx. Effect + dedupe row structurally share one tx. Existing specs pass (mocks ignore the new arg). 0 callers — free hardening.

- **M1 — CLOSED (doc).** `outbox-relay.ts:12-20`. Comment corrected to at-least-once + mandatory consumer dedupe, explicitly noting the lock releases when `fetchUnpublished`'s tx commits (before publish) so replicas/overlapping ticks can re-publish. Accurate now; recommends one relay per service. Behavior unchanged (was already at-least-once).

- **L1 — CLOSED.** `event-envelope.ts:56-61`. `headerToString` throws `MissingEventHeaderError` on empty string, not just undefined → no handler ever runs in tenant scope `""`. Unit test added. No false-skip risk: none of the six required identity headers is ever legitimately empty. Composes cleanly with C1 — an empty required header now decodes-fails → commit-skip.

- **L2 — CLOSED.** `outbox-relay.ts:105-107`. `this.timer.unref()` on every scheduled tick → a forgotten `stop()` can't hang shutdown/test runner.

- **H1 / L3 / L4 — deferred, acceptable to ship 3a.** H1 (poison-drop → DLQ) lands in 3d; that's the right slice. L3 (per-message sync commit) is a throughput tuning concern, not correctness. L4 (cp-kafka e2e vs apache/kafka compose) — compose reachability was manually verified. Reconfirm the H1 note: the C1 decode-skip and the handler-exhausted skip are BOTH silent drops today (only `logger.error`); 3d's DLQ must cover the decode-skip path too, not just handler exhaustion. Add a drop counter when DLQ lands so stuck sagas are observable.

## Regression scan
- Success path unchanged (commit extracted into `commitPast`, same `offset+1`).
- `IdempotentConsumer` signature change safe (0 callers; specs mock-tolerant).
- L1 empty-check does not reject any legitimate message.
- 21 unit + 2 e2e green, biome clean (reported).

## New issues
None.

## Unresolved questions
1. 3d DLQ scope must include BOTH skip paths — decode-undecodable (C1) and handler-exhausted (H1) — plus a drop metric. Confirm 3d captures the decode path, not only handler failures.
2. Ship-3a sign-off: H1/L3/L4 deferrals acknowledged — coordinator to confirm 3a merges with the DLQ gap documented as a 3d dependency.
