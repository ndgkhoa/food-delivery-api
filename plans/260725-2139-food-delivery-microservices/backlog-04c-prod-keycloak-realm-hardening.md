# Backlog 04c — Prod Keycloak realm hardening

Context: [plan.md](./plan.md) · [backlog-04b-k8s-network-policies.md](./backlog-04b-k8s-network-policies.md)

## Overview
- **Priority**: security — third/last security slice (04a signed identity → 04b NetworkPolicy → **04c prod Keycloak realm**).
- **Status**: ✅ Verified live (real Keycloak 26.7 import + minted-token RBAC proof) — branch `feat/prod-keycloak-realm-hardening`. Awaiting review/merge.
  - **Live proof (throwaway Keycloak 26.7, the exact dev image, `start-dev --import-realm` on the committed file)**: realm imports with no error; admin API confirms `sslRequired=external`, `bruteForceProtected=true` (failureFactor 5), password policy set, `registrationAllowed=false`, the `food-delivery-shortlived` client **gone**, the SPA client `directAccessGrantsEnabled=false` + explicit non-wildcard redirect/web origins, and **0 users**. RBAC end-to-end: created a user with a `tenant_id` + `customer` role, minted an access token, decoded it → `aud` includes `food-delivery-api`, `tenant_id` present, `realm_access.roles` includes `customer`. Dev `realm-export.json` byte-for-byte unchanged.
  - **Three bugs the live import caught that offline JSON-validation could NOT** (all fixed + re-verified):
    - **`unmanagedAttributePolicy: "DISABLED"` is not a valid enum** in KC 26.7 (accepts only `ENABLED`/`ADMIN_EDIT`/`ADMIN_VIEW`) → import crashed. To disable unmanaged attributes you **omit** the field (absent = disabled). Fixed by removing the key; `tenant_id` is declared as a managed attribute so its claim still flows.
    - **Client `description` was 423 chars** — Keycloak's `DESCRIPTION` column is `varchar(255)` → import crashed. Shortened to 204; the full rationale lives in this plan + the README.
    - **`fullScopeAllowed: false` silently dropped realm roles** — the minted token had `realm_access = null` (aud + tenant_id survived via their explicit mappers, but roles did not), which would break RBAC. Reverted to `fullScopeAllowed: true` (the first-party app client legitimately needs the user's roles); re-decoding then showed `realm_access.roles` with the assigned role. Documented in the client description + the risk table.
- **Brief**: `infra/keycloak/realm-export.json` is a **dev/e2e** artifact — imported by `infra/docker-compose.yml` AND the auth-e2e/gateway-e2e testcontainers (grep-confirmed). It is full of things that must NEVER reach prod: `sslRequired: none`, three hardcoded users with plaintext passwords (`admin-pass`/…), a `food-delivery-shortlived` 2s-token direct-grant client (e2e-only), `directAccessGrantsEnabled: true` (ROPC, "so tests can mint tokens by password"), and wildcard `redirectUris`/`webOrigins` (`*`) + `fullScopeAllowed: true` on the SPA client. Ship a SEPARATE hardened realm `infra/keycloak/realm-export.prod.json` for the managed/prod Keycloak, leaving the dev file untouched so dev + e2e stay green.

## Why a separate file (not a patch)
Keycloak realm JSON is imported wholesale (`--import-realm`); it is not kustomize-layerable, and CLAUDE.md explicitly says not to modularize config files. Dev and prod are genuinely different realms (different users, clients, SSL, lockout), so two files is the honest, idiomatic split — matching the k8s base(dev)/overlay(prod) pattern. Prod Keycloak is external/managed (the prod overlay points `KEYCLOAK_URL` at `https://auth.example.com`), so this file is the config artifact whoever provisions prod imports; it is not applied via kustomize.

## Hardening delta (prod realm vs the dev realm) — same realm name, roles, tenant_id + audience mappers, user-profile
- **`sslRequired`: `none` → `external`** — require HTTPS for all non-localhost traffic.
- **Brute-force detection**: `bruteForceProtected: true`, `failureFactor: 5`, `waitIncrementSeconds: 60`, `maxFailureWaitSeconds: 900`, `minimumQuickLoginWaitSeconds: 60`, `quickLoginCheckMilliSeconds: 1000`, `maxDeltaTimeSeconds: 43200`, `permanentLockout: false`.
- **Password policy**: `length(12) and upperCase(1) and lowerCase(1) and digits(1) and specialChars(1) and notUsername and passwordHistory(3)`.
- **Registration/account**: `registrationAllowed: false`, `resetPasswordAllowed: true`, `verifyEmail: true`, `editUsernameAllowed: false`, `loginWithEmailAllowed: true`, `duplicateEmailsAllowed: false`, `rememberMe: false`.
- **Sessions/tokens**: keep `accessTokenLifespan: 300`, `revokeRefreshToken: true`, `refreshTokenMaxReuse: 0`; add `ssoSessionIdleTimeout: 1800`, `ssoSessionMaxLifespan: 36000`, `offlineSessionIdleTimeout: 2592000`, `actionTokenGeneratedByUserLifespan: 300`.
- **SPA client hardening**: `directAccessGrantsEnabled: false` (no ROPC), `redirectUris: ["https://app.example.com/*"]` + `webOrigins: ["https://app.example.com"]` (explicit placeholders, NOT `*`). Keep PKCE S256, standard flow, publicClient, the audience + tenant_id mappers. **`fullScopeAllowed` stays `true`** — CORRECTED from an initial `false`: the live token proof showed `false` drops `realm_access.roles` entirely (RBAC break); this is the first-party app client and legitimately needs the user's realm roles in the token.
- **REMOVE** the `food-delivery-shortlived` client entirely (dev/e2e only).
- **NO users** (`users: []`) — real users come from registration/identity federation, provisioned per-tenant; none committed.
- **User profile**: declare `tenant_id` (+ username/email/first/last) as managed attributes so the `tenant_id` claim still flows; **omit `unmanagedAttributePolicy`** (absent = unmanaged attributes disabled, the hardened default — CORRECTED from an explicit `"DISABLED"`, which is not a valid KC 26.7 enum and crashed the import).

## Related files
- `infra/keycloak/realm-export.prod.json` (NEW) — the hardened realm.
- `infra/keycloak/README.md` (NEW, k8s/infra tree) — dev vs prod realm, import mechanism (`--import-realm`), and that prod users/client-secrets/redirect hosts come from the environment's secret manager + real domains, never committed.
- Dev `realm-export.json` — UNCHANGED (dev + e2e depend on it).

## Todo
- [x] author `realm-export.prod.json`: sslRequired external, brute-force, password policy, hardened SPA client, no shortlived client, no users, locked user-profile, session/token lifetimes
- [x] `infra/keycloak/README.md`: dev-vs-prod + import + secret-manager note
- [x] verify it imports cleanly into a throwaway Keycloak 26.7 — realm loads, SPA client present + hardened, shortlived gone, zero users; minted token carries roles + tenant_id + audience (3 import/RBAC bugs found + fixed)
- [x] confirm dev realm untouched (auth-e2e/gateway-e2e still reference the dev file); plan updated before push

## Success criteria
- `realm-export.prod.json` imports into a real Keycloak with no error; the realm shows `sslRequired=external`, brute-force on, the SPA client with `directAccessGrants=false` + non-wildcard redirect/origins, no `food-delivery-shortlived`, and zero users.
- The dev `realm-export.json` is byte-for-byte unchanged; auth-e2e + gateway-e2e remain green (they import the dev file).
- RBAC still works: a token from the hardened SPA client still carries realm roles + `tenant_id` + the `food-delivery-api` audience (the mappers are preserved).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| `fullScopeAllowed: false` drops realm roles from the token → RBAC breaks | M×H | The default `roles` client scope maps realm roles into `realm_access.roles` regardless of fullScopeAllowed; verify the imported token still carries roles |
| Hardened realm fails to import (schema/typo) | M×H | Import into a throwaway Keycloak before merge — the definitive check |
| Someone imports the dev realm into prod by mistake | M×H | README names the prod file explicitly + the dev file warns it is dev/e2e-only; prod overlay `KEYCLOAK_URL` is external (separate provisioning) |
| Wildcard removal breaks the real SPA redirect | L×M | Placeholder `app.example.com` is documented as replace-at-deploy; the real origin comes from the environment |

## Security considerations
- The dev realm's plaintext test users, ROPC, wildcard origins, and `sslRequired: none` are precisely the prod-dangerous bits — the whole point is they never ship. Two files keeps the dangerous dev conveniences physically out of the prod artifact.
- Brute-force + password policy + HTTPS-required are table-stakes prod hardening absent from the dev realm.
- Client secrets / real users / real redirect hosts stay in the secret manager, never committed — the file carries only non-secret structure + placeholders.

## Next steps
Security slices (04a/04b/04c) complete. Then D-items: Argo Rollouts, cosign/SLSA provenance, k6 load test, BullMQ trace/metric propagation. (Docs/README + CI badges deferred by the user.)
