# Code Review — Prod Keycloak Realm Hardening (backlog-04c)

**Branch:** `feat/prod-keycloak-realm-hardening` · **Reviewer:** code-reviewer · **Date:** 2026-08-03

## Scope
- `infra/keycloak/realm-export.prod.json` (NEW, 111 lines) — hardened prod realm
- `infra/keycloak/README.md` (NEW) — dev-vs-prod + import + secret-manager notes
- Diffed against `infra/keycloak/realm-export.json` (dev, UNCHANGED)
- Spec: `backlog-04c-prod-keycloak-realm-hardening.md`

## Overall Assessment
**Appropriately hardened.** The core prod-dangerous dev artifacts are gone: `sslRequired` is `external`, no seeded users (`users: []`), no `food-delivery-shortlived` client, SPA `directAccessGrantsEnabled: false` (no ROPC), explicit non-wildcard redirect/web origins, brute-force + strong password policy, refresh-token rotation. Mappers (audience + `tenant_id`) are byte-identical to dev, so gateway audience validation and the tenant/RBAC flow are preserved (matches the live token proof). The `tenant_id` user-profile attribute being **edit-locked to admin** is a strong anti-tenant-hopping control worth calling out as a positive.

Findings below are refinements, not blockers to the verified hardening — but two (H1, H2) are README/prod-readiness gaps that should be fixed before an operator provisions prod.

---

## High

### H1 — README states `fullScopeAllowed: false`, actual file is `true` (doc contradicts verified reality)
- **Where:** `infra/keycloak/README.md:10` (`"...fullScopeAllowed: false, locked user profile."`) vs `realm-export.prod.json:60` (`"fullScopeAllowed": true`).
- **Risk:** The plan spent a live-verification cycle proving `false` drops `realm_access.roles` and breaks RBAC, and deliberately set `true`. The README still documents the *reverted, broken* value. An operator auditing posture against the README may "correct" the file to `false` to match the doc → silent RBAC break (tokens lose realm roles; every role-gated route 403s). This is the exact regression the plan warned about, re-introduced via stale docs.
- **Fix:** Update README:10 to `fullScopeAllowed: true` and add a one-line why (`first-party client needs realm roles in-token for RBAC; false drops realm_access.roles`), mirroring the client `description` already in the JSON.

### H2 — `verifyEmail: true` + `resetPasswordAllowed: true` with no SMTP, and README omits SMTP as a replace-at-deploy dependency
- **Where:** `realm-export.prod.json:6,10` (`resetPasswordAllowed`, `verifyEmail`); no `smtpServer` block anywhere in the file; `README.md:19-30` replace-at-deploy list covers origins/users/secrets but **not SMTP**.
- **Risk:** `verifyEmail: true` forces new users to confirm email before first login. With no SMTP configured at import, the verification mail never sends → a freshly provisioned (non-federated) user is locked out until an admin manually flips `emailVerified`. `resetPasswordAllowed: true` self-service reset silently fails the same way. This is a real prod-readiness gap and, unlike origins/users/secrets, it is undocumented — so it does not get the "documented deploy-time responsibility" down-rank.
- **Fix:** Add SMTP to the README replace-at-deploy list ("configure `smtpServer` from the environment; `verifyEmail`/`resetPassword` require it"). Optionally note that federated/admin-provisioned users can set `emailVerified: true` to bypass. No secret goes in the file — this is a documentation fix.

---

## Medium

### M1 — `offline_access` optional scope on a public browser client + no offline-session max cap
- **Where:** `realm-export.prod.json:68` (`optionalClientScopes: [..., "offline_access"]`) on the `publicClient: true` SPA; `offlineSessionIdleTimeout: 2592000` (30d) with no `offlineSessionMaxLifespan` set (uncapped, idle-rolling).
- **Risk:** A public SPA (token in browser storage) that requests `offline_access` receives a refresh token that survives 30 days of idle-rolling with no absolute cap. For a browser client this is a long-lived-credential exfiltration surface that the tighter `ssoSessionMaxLifespan: 36000` (10h) is meant to bound. Refresh rotation (`revokeRefreshToken: true`, `refreshTokenMaxReuse: 0`) mitigates replay but not theft of the current token. First-party SPAs rarely need offline tokens.
- **Fix (pick one):** Drop `offline_access` from the SPA `optionalClientScopes` (cleanest for a browser client); or if offline is intended, set `offlineSessionMaxLifespanEnabled: true` + a bounded `offlineSessionMaxLifespan`. Out of scope to change if product requires offline — flag as a deliberate decision if so.

### M2 — `tenant_id` user-profile attribute is not `required`
- **Where:** `realm-export.prod.json:105` — the `tenant_id` attribute declares permissions (edit=admin) but has no `required` block; other attributes (`email`) do gate on role.
- **Risk:** A user can be provisioned (admin/federation) with no `tenant_id`. Their token then carries no `tenant_id` claim. Depending on the gateway/tenant middleware, that either 500s, or worse silently defaults to a wrong/empty tenant → cross-tenant data exposure. The README says every user "needs a `tenant_id` attribute" but nothing enforces it.
- **Fix:** Add `"required": {"roles": ["user"]}` to the `tenant_id` attribute so the profile layer rejects tenant-less users, **and/or** confirm the gateway rejects tokens with a missing `tenant_id` claim (defense in depth — verify the JWT guard treats absent `tenant_id` as 401, not as a default). If federation always injects `tenant_id`, note that as the compensating control.

---

## Low / Informational

- **L1 — Redirect path wildcard `https://app.example.com/*` (`:61`, `:65`):** path-level wildcard is standard for SPAs; combined with the RFC-2606 `example.com` placeholder it is clearly non-production and README:23-25 flags replacement. Acceptable. Just ensure the real value is a specific origin, not re-wildcarded.
- **L2 — `bruteForceStrategy` not set (`:12-19`):** KC 26.7 defaults to `MULTIPLE` (exponential backoff), which matches the configured `waitIncrement`/`maxFailureWait`. Fine to leave; note it if you ever want `LINEAR`.
- **L3 — No `otpPolicy`/`webAuthnPolicy`/`requiredActions` (MFA):** out of scope per plan. `VERIFY_EMAIL` is handled by the realm `verifyEmail` flag, so no per-user required action needed. If MFA is later intended, add here.
- **L4 — `accessTokenLifespanForImplicitFlow: 900` (`:22`):** moot — `implicitFlowEnabled: false` on the only client. Harmless; could drop for tidiness.
- **Lifetimes sanity:** `accessTokenLifespan 300` (5m), `ssoSessionIdleTimeout 1800` (30m), `ssoSessionMaxLifespan 36000` (10h) are all reasonable for this app. Brute-force `failureFactor 5 / waitIncrement 60 / maxFailureWait 900` is sane (5 fails → escalating lock, capped 15m, non-permanent so no lockout-DoS). Password policy `length(12)+classes+notUsername+history(3)` is strong.

---

## Positive Observations
- Dev realm left byte-for-byte intact (dev/e2e stay green) — clean two-file split, no risky patch.
- `tenant_id` edit permission locked to `admin` in the user profile — users cannot self-set/alter their tenant, closing a tenant-hopping/privilege-escalation vector.
- Unmanaged attributes disabled via omission (the KC-26.7-correct way; the plan caught the invalid `"DISABLED"` enum live) — arbitrary attribute injection is blocked while declared `tenant_id` still flows.
- Audience + `tenant_id` mappers preserved verbatim from dev → gateway JWT audience check and RBAC unaffected.
- `fullScopeAllowed: true` is the right call for this first-party client (verified) — flagged only because the README contradicts it (H1).
- README correctly and prominently warns against importing the dev realm into prod (README:32-33) and correctly describes `--import-realm`.

---

## Recommended Actions (priority order)
1. **H1** — fix README `fullScopeAllowed: false` → `true` (prevents an operator from reverting the RBAC fix).
2. **H2** — add SMTP to README replace-at-deploy list (unblocks `verifyEmail`/`resetPassword` in prod).
3. **M2** — make `tenant_id` required in the user profile and/or verify the gateway 401s on missing `tenant_id`.
4. **M1** — drop `offline_access` from the SPA optional scopes (or cap offline session max) for a browser client.
5. **L4** — optionally remove the moot implicit-flow lifespan.

## Unresolved Questions
- Does the prod front end actually need `offline_access` (long-lived offline tokens in a browser), or was it inherited from the dev client copy? (drives M1)
- Does the gateway/tenant middleware reject a token with a **missing** `tenant_id` claim, or default it? (drives M2 severity — if it hard-rejects, M2 drops to Low)
- Is prod user provisioning always via identity federation (which injects `tenant_id` + pre-verifies email), which would soften H2/M2? README implies "registration or federation" — confirm the primary path.
