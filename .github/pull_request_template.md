<!--
Title MUST follow: type(scope): subject   e.g.  feat(catalog): add restaurant CRUD
Allowed type: feat | fix | chore | refactor | test | docs | perf | build | ci
scope = a service or shared lib (catalog, order, gateway, shared-logging, infra, ci, ...)
🚫 The word "phase" (or finding codes) is FORBIDDEN in title, branch, and commits — name by CODE CONTENT, not plan progress.
-->

## What & Why
<!-- What does this change do, and why? Link the driving issue. -->
- Summary:
- Refs: #

## Type of change
- [ ] feat — new feature
- [ ] fix — bug fix
- [ ] refactor — no behavior change
- [ ] perf — performance
- [ ] test — tests only
- [ ] docs — docs only
- [ ] chore / build / ci — tooling/infra

## Scope(s) touched
<!-- Services / libs, e.g. catalog, order, shared-messaging -->
-

## How tested
<!-- Commands run + what you verified. Attach output/screenshots for API/UI changes. -->
-

## Checklist (Definition of Done)
- [ ] Tests added/updated and passing (`nx affected -t test`)
- [ ] `biome check` clean (format + lint + imports)
- [ ] `dependency-cruiser` passes — no forbidden cross-context imports
- [ ] `knip` clean — no dead code / unused deps introduced
- [ ] No secrets committed; `.env.example` updated if new env added
- [ ] OpenAPI spec updated if the API changed (Scalar reflects it)
- [ ] Audit-log / soft-delete / tenant-scope respected on new writes
- [ ] Docs updated if behavior/contract changed
- [ ] Conventional Commits with **mandatory scope**; **no "phase"** / plan refs in branch, commits, or names

## Notes for reviewer
<!-- Anything to focus on, trade-offs, follow-ups. -->
-
