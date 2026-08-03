# Development Workflow (Agile) — Food Delivery Microservices

How every change moves from idea → merged. Applies to all work. Context: [plan.md](./plan.md) · [architecture.md](./architecture.md).

## 1. Iteration model

Work in small **vertical slices** (one feature = one branch = one PR). No big-bang merges. Each slice is independently reviewable, tested, and shippable. The plan's phases are a *learning roadmap* only — they NEVER appear in git artifacts (see §5).

**Branch model (Git Flow):** `main` = production/release only (protected; never coded on directly). `develop` = integration branch. Every slice branches OFF `develop`, PRs back INTO `develop`, and the branch is deleted after merge. Releases promote `develop` → `main`. Never commit directly to `main` or `develop`.

## 2. The loop (per slice)

```
1. Pick a slice (a feature/fix, sized to ~1 PR)
2. Branch off develop:  <type>/<scope>-<short-desc>
3. Develop  → write code + tests together
4. Local gate (Lefthook pre-commit runs automatically):
      biome check --write  ·  commitlint (commit-msg)
5. Self-check:  test  ·  cruiser boundaries  ·  knip  (all green)
6. **Update the plan BEFORE pushing**: tick the completed todos + set phase/slice status in `plans/…` (commit it on the branch). Push must never run ahead of the plan.
7. Push → open PR (fill .github/pull_request_template.md)
8. CI must pass (see §4)
9. Code review (code-reviewer) → address feedback
10. All green + approved → squash-merge into develop → delete branch (local + remote)
11. Renovate keeps deps/images current via its own PRs
```

Never commit directly to `main` or `develop`. Never merge red CI or unreviewed code. **Never push before the plan + todos reflect what the push contains.**

## 3. Definition of Done (DoD)

A slice is DONE only when ALL hold:
- [ ] Code implements the requirement; edge cases + errors handled
- [ ] Tests written and passing (unit + integration for the slice; e2e where it applies)
- [ ] `biome check` clean (format + lint + imports)
- [ ] `dependency-cruiser` passes — no forbidden cross-context imports
- [ ] `knip` clean — no dead code / unused deps introduced
- [ ] No secrets committed; `.env.example` updated if new env added
- [ ] OpenAPI spec updated if API changed (Scalar UI reflects it)
- [ ] Audit-log / soft-delete / tenant-scope respected on new writes
- [ ] **Plan updated BEFORE push**: todos ticked + phase/slice status set in `plans/…`
- [ ] PR reviewed and approved; CI green
- [ ] Docs updated if behavior/contract changed

## 4. CI gates (GitHub Actions, `nx affected`)

On every PR, in order: `biome check` → `dependency-cruiser` → `knip` → `nx affected -t test` → build images → **Trivy** (image + config scan) → **Hadolint** (Dockerfiles) → **actionlint** (workflow files). Merge blocked unless all pass.

## 5. 🚫 Naming rule (HARD — no exceptions)

Branch, commit, PR title/body, test names, migration filenames, and code comments describe **CODE CONTENT**, never plan progress. The token **`phase`** (and finding/audit codes like F1, Y2) is **FORBIDDEN** in any git or code artifact.

Why: plan headers get renumbered / disappear → such references rot. The reason for code (the invariant, the race, the trade-off) must be stable and self-contained. Plan/phase numbers live ONLY in `plans/…` markdown.

| ❌ Forbidden | ✅ Use instead |
|---|---|
| `phase-0`, `feat/phase-1-auth` | `feat/catalog-crud`, `feat/keycloak-jwt-guard` |
| `feat: phase 3 kafka` | `feat(order): emit events via outbox` |
| `TestOrderPhase2` | `TestReserveStock_Concurrent` |
| `000003_phase_0a_...sql` | `000003_add_order_partitions.up.sql` |

## 6. Branch naming

`<type>/<scope>-<short-kebab-desc>` — e.g. `feat/catalog-menu-crud`, `fix/order-idempotency-key`, `chore/lefthook-setup`, `refactor/shared-logging`.
`type` ∈ feat · fix · chore · refactor · test · docs · perf · build · ci.

## 7. Commit convention (MANDATORY scope)

Conventional Commits with a **required scope** — enforced by Commitlint (`scope-empty: never`):

```
type(scope): subject        # imperative, lowercase, no trailing period

feat(catalog): add restaurant CRUD with soft delete
fix(order): make reserve-stock idempotent on retry
chore(shared-config): add env schema validation
```

- **scope** = a service or shared lib: `gateway, auth, catalog, search, order, inventory, payment, delivery, notification, media, analytics, review, config, shared-config, shared-logging, shared-messaging, shared-tenancy, infra, ci`.
- Body explains WHY when non-obvious. Footer: `BREAKING CHANGE:` / `Refs #<issue>`.
- No AI references. No "phase". Small, focused commits.

## 8. PR rules

- One slice per PR; keep it small enough to review well.
- Fill `.github/pull_request_template.md` completely.
- Title follows the same `type(scope): subject` convention (no "phase").
- Base branch = `develop`. Squash-merge; the squash commit message must also be a valid scoped Conventional Commit. Delete the branch after merge.
- At least one approving review + green CI before merge.

## Open questions

None — conventions fixed. Adjust scope list as new services/libs appear.
