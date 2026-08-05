# Red-team review — slice 5a: payment durable ChargeWorkflow (Temporal)

Branch `feat/payment-temporal-workflow` · `git diff develop...HEAD` (1 commit). Runtime proven green; this review hunts correctness/security bugs the happy path doesn't exercise. Temporal SDK 1.21.1.

Scope: `apps/payment/src/{workflows,activities,infrastructure/temporal,interface/http,interface/messaging}`, `config`, `main.ts`, `.dependency-cruiser.js`, `apps/payment-e2e/*`.

---

## Critical

### C1 — Idempotency-by-workflowId is only true while the workflow is RUNNING; a redelivered command after the workflow CLOSES starts a NEW run (re-charge)
`temporal-workflow-gateway.adapter.ts:37-52`, comment lines 18-24; consumer `payment-command.consumer.ts:75`.

`client.start()` is called with **no `workflowIdReusePolicy`**. In Temporal 1.21.1 the default reuse policy is `ALLOW_DUPLICATE`: once a workflow with id `charge-{orderId}` has **closed**, starting the same id again is *allowed* and creates a brand-new run. `WorkflowExecutionAlreadyStartedError` fires **only while the prior run is still open** (running). The adapter's comment ("...or closed, within retention...raises WorkflowExecutionAlreadyStartedError") is therefore incorrect.

Real failure sequence:
1. `ChargePayment` consumed → `startCharge` → workflow runs charge + the 2s reconcile window, emits reply, **closes** (typically <3s).
2. Consumer commits offsets *after* the handler (`kafka-consumer.ts:180-183`, manual commit, offset+1 post-handler). If the process dies / rebalances between `startCharge` succeeding and the offset commit, or a duplicate is produced, the command **redelivers**.
3. By then the first run has closed → `start()` does **not** throw → a **second workflow run** executes the `charge` activity again.

Why it's not (yet) catastrophic: `emitReply` dedupes on `orderId` in `processed_events` (see C-context below), so the **second run's reply is suppressed** — the saga still sees one reply. So the *observable* guarantee holds **today only because `processed_events(orderId)` backstops it**, NOT because of workflow-id idempotency as the code claims. The `charge` activity itself re-executes on the second run; harmless for the current pure stub, but a real PSP charge activity here would **double-charge**.

Also note: the e2e "idempotent by workflow id" test (`payment-charge-workflow.e2e-spec.ts:44-54`) only fires the two commands back-to-back, so the 2s window keeps run #1 open and the redelivery hits the *running* AlreadyStarted path. The closed-run redelivery path is **untested**.

Fix: set `workflowIdReusePolicy: WorkflowIdReusePolicy.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE` (and, on 1.21, `workflowIdConflictPolicy: ...USE_EXISTING` or keep default Fail) on `client.start()`. That makes a duplicate id reject even after close, restoring true id-idempotency *within the retention window*. Keep the `processed_events` ledger as the after-retention backstop, and correct the comment to say so. When the real PSP lands, the `charge` activity must additionally carry a provider idempotency key.

---

## High

### H1 — Webhook HMAC secret has a public hardcoded default → forgeable callbacks in any env where the var is unset
`payment-env-schema.ts:35` `PAYMENT_WEBHOOK_SECRET: z.string().min(1).default('dev-payment-webhook-secret')`; `.env.example:38`; controller `payment-webhook.controller.ts:49` uses `getOrThrow`.

Because the schema supplies a default, `getOrThrow` never throws — a production deploy that forgets to set the var silently runs with the **publicly-known** `dev-payment-webhook-secret`. Anyone can then compute a valid signature and signal any in-window `charge-{orderId}` workflow (flip a decision). This is an auth-bypass-by-misconfiguration.

Fix: drop the default (require the secret) and fail closed at boot in non-dev, e.g. `.default()` only when `NODE_ENV !== 'production'`, or a superRefine that rejects the dev sentinel in prod. Minimum: no shipped default value.

### H2 — Fixed 2s latency tax on every charge (no-webhook default path)
`charge-workflow.ts:52` `await condition(() => reconciled !== undefined, RECONCILE_WINDOW)`.

With no webhook (the default and overwhelmingly common path), the predicate never becomes true, so the workflow **always waits the full 2 seconds** before emitting the reply. Every order's payment leg pays a flat +2s. For checkout UX / saga latency that is significant and unconditional. Intentional per the comment, but real.

Fix: only arm the wait when a webhook is actually expected (e.g. provider marked the charge async / returned a "pending" verdict), otherwise emit immediately. If the wait must stay, make it a much smaller default and/or resolve early on a terminal synchronous verdict.

### H3 — 2s reconcile window realistically loses the race for any real async provider → webhook/signal feature is effectively decorative and mostly 500s
`charge-workflow.ts:14,52` + adapter `signalProviderResult` (`:54-58`).

A real provider async callback traverses the network and provider-side processing; it will almost never arrive within 2s of our synchronous `charge` activity. So the workflow closes with the synchronous `decided` result, and the later webhook calls `handle.signal` on a **closed** workflow → Temporal throws (`WorkflowNotFound`), the controller doesn't catch it → **HTTP 500** to the provider, which then retries forever. Same 500 if the callback arrives **before** the workflow is started (pre-start race — `getHandle` on a not-yet-created id). Net: the reconciliation feature works only in a narrow demo window and otherwise produces provider-facing 500s.

Fix: (a) catch not-found/already-closed in the webhook path and return 200/202 (idempotent ack) instead of 500; (b) consider `signalWithStart` (or a longer/decision-gated window) if reconciliation is meant to be real; (c) at minimum document that reconciliation is best-effort within 2s.

---

## Medium

### M1 — No nonce/idempotency on the webhook; a captured signed request is replayable within ±300s
`hmac-webhook-verifier.ts:61-65`. Signature + timestamp only; no per-message nonce/jti and no consumed-signature ledger. Within the 300s window the same signed body can be re-POSTed repeatedly. Real impact here is small (2s workflow window ⇒ replays land on a closed workflow ⇒ 500, harmless to saga; in-window replays just re-set `reconciled` to the same value, idempotent). Worth noting because the 300s tolerance vastly exceeds the 2s window, so the replay surface is entirely "signal a closed/other workflow". Fix if reconciliation window grows: record a nonce (or `orderId`+`timestamp`) and reject repeats.

### M2 — `emitReply` dedupe key is `orderId`, sharing the `processed_events` namespace with (former) command event-ids and blocking any legitimate re-charge of an order
`emit-reply.activity.ts:41` `IdempotentConsumer.runOnce(deps.processedEvents, input.orderId, undefined, …)`.

Verified correct for the intended "exactly one reply per order" (see verified section). Two caveats: (a) the key is the business `orderId`, not a per-charge-attempt id — a legitimate second charge of the same order (retry after refund/void, future flows) would be silently deduped to no reply; (b) `processed_events` PKs now mix `orderId` (UUID) with historical command event-ids (UUID) in one table — collision probability negligible but the namespaces are conflated. Consider a per-charge idempotency key (e.g. `charge-{orderId}` or a run-scoped id) when charges become re-issuable.

### M3 — Payment boots hard-dependent on Temporal; unreachable Temporal crashes the whole app (also kills the webhook + Kafka consumer)
`temporal-client.module.ts:27-28` (`Connection.connect` eager) and `temporal-worker.provider.ts:49-51` (`NativeConnection.connect`). If Temporal is down at boot the app fails to start, taking the HTTP webhook and command consumer with it. Acceptable for a workflow-centric service, but undocumented as a hard coupling. Confirm intended; document the ordering dependency (Temporal must be up before payment).

### M4 — `resolveWorkflowsPath` resolves against `process.cwd()`, not the bundle location
`temporal-worker.provider.ts:83-86` `resolve(override ?? 'apps/payment/src/workflows')`. Works when launched from the workspace root (`nx serve`), but in a container whose working dir differs and where `TEMPORAL_WORKFLOWS_PATH` isn't set, `resolve()` produces a cwd-relative path that won't exist → worker create fails at boot. The comment acknowledges the deviation; ensure the container image always sets `TEMPORAL_WORKFLOWS_PATH` (or ships workflows at `<cwd>/apps/payment/src/workflows`). Consider defaulting off `__dirname`/`app.getPath`-style anchor instead of cwd.

---

## Low

### L1 — dependency-cruiser rules only enforce purity on DIRECT imports and enumerate 5 layer dirs; a workflow importing a same-app path outside those dirs slips
`.dependency-cruiser.js` new rules (`workflow-code-no-app-layers`, `workflow-code-only-temporal-npm`). They correctly guard every file under `apps/*/src/workflows/` (so the pure `charge-workflow.types.ts`, being in that dir, is covered — good). But rule 1's `to` lists only `domain|application|infrastructure|interface|activities`; a future `import from '@payment/shared/…'` or `@payment/config/…` (not in that list) would not be flagged. Rule 2 does catch stray npm. Net exposure is small (any non-@temporalio npm is blocked; only a same-app non-enumerated *local* dir is a gap). Tighten rule 1 to an allowlist ("workflows may import only workflows/**") rather than a denylist of 5 dirs.

### L2 — Webhook is authenticated by a single shared secret but not per-tenant/authorization-scoped
`payment-webhook.controller.ts:60`. Anyone holding the one provider secret can signal any `orderId` regardless of tenant. Standard for a single-provider callback trust model; acceptable, but note there's no binding between the signed callback and the tenant/owner of the order. Revisit if multiple providers/tenants get distinct secrets.

---

## Verified correct

- **Workflow determinism (C1's cousin — clean):** `charge-workflow.ts` imports only `@temporalio/workflow` + `./charge-workflow.types` (which has zero imports). No `Date.now`/`Math.random`/IO/config. Waits use workflow `condition`; retries/timers are declarative via `proxyActivities`. No Map/Set iteration. `setHandler(providerResultSignal, …)` is registered at line 45 **before** the first `await` (line 49), so a signal buffered before the wait is honored. Fully replay-safe.
- **Exactly-once reply under activity retry (within one run):** `emitReply` runs `IdempotentConsumer.runOnce(processedEvents, orderId, …)` inside `transaction.runInTransaction`. `TypeOrmTransactionAdapter` publishes the `EntityManager` on AsyncLocalStorage; both `markProcessed` (PK insert on `orderId`) and `outbox.append` enlist in that same tx (`typeorm-processed-event.store.ts:32-34`), committing atomically. A retried `emitReply` hits the unique-violation → `DuplicateEventError` → skips the append. Passing `tx=undefined` is fine because the adapters read the ALS manager, not the arg. One outbox row per order.
- **Charge determinism across retries:** `decideCharge` (`charge-decision.ts:12-17`) is a pure function of `(totalCents, failAtCents)`; every retry reaches the same verdict. Activity input is fixed by Temporal, so args don't drift.
- **Single reply, no contradictory saga state:** exactly one `emitReply` call per workflow; `outcome = reconciled ?? decided` is computed once. No path emits twice.
- **HMAC construction:** signs `${timestamp}.${rawBody}` over the raw request bytes (`main.ts:17` `rawBody: true`; controller reads `req.rawBody`), binding body+time. Constant-time compare via `timingSafeEqual` on equal-length buffers, guarded against 0-length/short/malformed hex (`hmac-webhook-verifier.ts:33-40`). Missing signature / missing timestamp / non-finite timestamp / out-of-window / mismatch all fail closed → controller throws `UnauthorizedException` (401), never 500-on-accept. Header array-value handled.
- **Connection lifecycle:** worker `onModuleDestroy` calls `worker.shutdown()`, drains `runPromise`, then closes its `NativeConnection`; the separate client `Connection` is closed by `TemporalConnectionCloser.onApplicationShutdown`. Two distinct connections, each with matching teardown — no leak, no double-close.
- **Tenant scope:** `emitReply` re-establishes tenant via `tenantContext.run({ tenantId })` from the workflow input, threaded from `envelope.tenantId` in the consumer. e2e uses a valid UUID tenant (`aaaaaaaa-aaaa-4aaa-8aaa-…`, `payment-charge-workflow.e2e-spec.ts:22`). No non-UUID tenant found in the changed paths.
- **Conventions:** activities own all IO/config; factory wiring is clean; files <200 LOC; no "phase"/finding tokens in code/comments.

---

## Unresolved questions

1. Is the closed-run redelivery (C1) considered in-scope for this slice, or deferred until the real PSP replaces the stub? Recommendation is to add `REJECT_DUPLICATE` now — it's a one-line hardening that matches the code's own stated guarantee.
2. Is the 2s reconcile window (H2/H3) a deliberate demo artifact to be removed before real providers, or the intended production behavior? If the latter, the webhook 500-on-closed-workflow (H3) needs fixing regardless.
3. Should `emitReply` dedupe on a per-charge-attempt id rather than `orderId` (M2) to allow legitimate re-charges of an order later in the roadmap?

---

**Status:** DONE_WITH_CONCERNS
**Summary:** Determinism, exactly-once-reply (via `processed_events`), and HMAC verification are solid. But workflow-id idempotency is weaker than the code claims, and the webhook secret ships a public default.
**Most important finding:** C1 — with Temporal's default `ALLOW_DUPLICATE` reuse policy, a command redelivered after the workflow closes starts a *new* run (re-executing the charge activity); only the `processed_events(orderId)` ledger prevents a double reply. Set `workflowIdReusePolicy: REJECT_DUPLICATE` and correct the idempotency comment.
