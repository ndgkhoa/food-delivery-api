# Catalog Import Alias Migration Report

Date: 2026-07-27
Scope: Convert all in-app relative imports in the catalog service to the `@catalog/*` TypeScript path alias; keep all quality gates green. No commit/push.

## (a) Conversion counts

- `apps/catalog/src/**/*.ts`: **170 relative imports converted across 44 files** (via a deterministic AST-agnostic specifier rewrite: resolve each `./` or `../` specifier to an absolute path, keep only those under `apps/catalog/src`, rewrite to `@catalog/<rel>`).
- `apps/catalog-e2e/src/catalog-restaurants-menu-crud.e2e-spec.ts`: **2 imports converted**
  - static: `../../catalog/src/testing/catalog-test-database` -> `@catalog/testing/catalog-test-database`
  - dynamic (kept dynamic): `await import('../../catalog/src/app.module')` -> `await import('@catalog/app.module')`
- Remaining relative in-app imports after conversion: **0** (verified by grep).
- `import type` vs `import` type-ness preserved exactly (40 `import type ... from '@catalog...'` remain type-only; no type-ness flipped).
- `@food-delivery-api/*` lib imports (3) and all third-party imports (`@nestjs/*`, `typeorm`, `node:*`, `class-validator`, `dotenv`, `reflect-metadata`, etc.) left untouched. 0 external modules accidentally aliased.
- Probe file `application/restaurant/restaurant-handlers.spec.ts` finished: its same-directory `./commands/...` / `./queries/...` imports were also converted to `@catalog/...`, now fully consistent.
- Biome `organizeImports` reordered imports in 37 files (safe fix, mechanical) because `@catalog/*` sorts differently than the old relative paths. Applied via `biome check --write .`.

## (b) tsconfig-paths version + final migration scripts

- Installed `tsconfig-paths@4.2.0` as a workspace-root devDependency (`pnpm add -D -w tsconfig-paths`; the `-w` flag was required because this is a pnpm workspace root). 4.2.0 is the current latest.

Final `package.json` scripts:

```
"migration:generate": "TS_NODE_PROJECT=apps/catalog/tsconfig.app.json node -r ts-node/register -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:generate -d apps/catalog/src/infrastructure/persistence/data-source.ts",
"migration:run": "TS_NODE_PROJECT=apps/catalog/tsconfig.app.json node -r ts-node/register -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:run -d apps/catalog/src/infrastructure/persistence/data-source.ts",
"migration:revert": "TS_NODE_PROJECT=apps/catalog/tsconfig.app.json node -r ts-node/register -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:revert -d apps/catalog/src/infrastructure/persistence/data-source.ts",
```

`tsconfig.app.json` inherits `baseUrl` (`.` = workspace root) and `paths` (`@catalog/*`) through its extends chain (`tsconfig.app.json` -> `tsconfig.json` -> `tsconfig.base.json`), so `tsconfig-paths/register` resolves the alias correctly. `TS_NODE_PROJECT` is honored by `tsconfig-paths/register`. No `baseUrl`/`paths` additions were needed.

## (c) Verification outputs

- `pnpm install`: Already up to date, clean.
- `pnpm nx build catalog` (webpack): `webpack compiled successfully` — `@catalog/*` resolves in the webpack build OOTB.
- `pnpm biome check .`: clean (0 errors; only 1 pre-existing informational `biome migrate` config hint, unrelated). Imports ordered, `import type` preserved.
- `pnpm cruiser`: `no dependency violations found (92 modules, 271 dependencies cruised)` — layer rules still hold with aliases resolved to real files.
- `pnpm knip --no-config-hints`: clean (exit 0, no findings) — see note (e).
- `pnpm nx test catalog --testPathPatterns='domain|application'`: **4 suites / 26 tests passed** — proves Jest/ts-jest resolves `@catalog/*` with NO moduleNameMapper.
- Migration alias check `pnpm migration:run` (against locally running Postgres): failed with `error: password authentication failed for user "postgres"` (SQLSTATE `28P01`, `auth_failed`). This is a DB-credential error, NOT `Cannot find module '@catalog/...'` — ts-node + tsconfig-paths successfully compiled `data-source.ts`, resolved `@catalog/infrastructure/persistence/typeorm-options`, built the DataSource, and attempted a real connection. Alias resolution PASSED. (`docker:core:up` was not needed; a Postgres was already listening and rejected the password.)

## (d) Ambiguous conversions

None. Every relative specifier resolved unambiguously to a file under `apps/catalog/src`. No dynamic `import()`, `jest.mock()`, `require()`, or re-export-from relative specifiers exist in `apps/catalog/src` (verified). The only dynamic import (in catalog-e2e) was kept dynamic.

## (e) Jest moduleNameMapper — NOT added

Confirmed NO `moduleNameMapper` / `pathsToModuleNameMapper` added to any jest config (root `jest.config.ts`, `jest.preset.js`, `apps/catalog/jest.config.cts`, `apps/catalog-e2e/jest.config.cts`). ts-jest resolves the alias via `tsconfig.spec.json` (inherits paths) OOTB.

## Extra config change (required, flagging per rules)

One config change beyond the migration scripts was necessary to keep knip green:

- Added a `paths` map to `knip.json`:
  ```
  "paths": { "@catalog/*": ["apps/catalog/src/*"] }
  ```

Reason: `apps/catalog/src/testing/catalog-test-database.ts` is the one file that lives outside all tsconfig `include` coverage — `tsconfig.app.json` excludes `src/testing/**`, and `tsconfig.spec.json` includes only `*.spec.ts` / `*.test.ts` / `*.d.ts` (not `testing/**`). There is also no root `tsconfig.json`. So when knip analyzed that file's imports it had no tsconfig-paths context and reported its new `@catalog/...` import as an unlisted dependency, cascading to the migration file being "unused" and `catalogOrmEntities` being an "unused export". (Before conversion this file used a relative import needing no path mapping, which is why the gate was previously green.) Every other file resolves the alias fine because each is covered by a tsconfig carrying the inherited paths.

This `knip.json` `paths` addition is contained entirely to knip — it cannot affect webpack/jest/ts/cruiser behavior — so it is the lowest-risk fix. Alternative (not chosen): add `src/testing/**/*.ts` to `tsconfig.spec.json` include; rejected as broader and touching TS compile config. Flagging because the task brief anticipated only `knip.json` entry-path edits, not a `paths` addition.

## Files changed (not committed)

- 44 `apps/catalog/src/**/*.ts` + 1 `apps/catalog-e2e/src/*.e2e-spec.ts` (imports)
- `package.json` (migration scripts + tsconfig-paths devDep), `pnpm-lock.yaml`
- `knip.json` (paths map)
- Pre-existing branch changes NOT made by me and left as-is: `tsconfig.base.json` (the `@catalog/*` alias, already added per brief) and `.env.example` (shellcheck comment).

## Unresolved questions

1. Is adding `paths` to `knip.json` acceptable, or is the preferred fix to instead include `src/testing/**/*.ts` in `tsconfig.spec.json` (more "correct" tsconfig coverage, DRY on the alias, but changes test compile config)? I chose the knip-contained option to avoid touching TS compilation.

Status: DONE_WITH_CONCERNS
Summary: All 170 src + 2 e2e in-app relative imports converted to `@catalog/*`; build/biome/cruiser/knip/unit-tests green; migration alias resolution verified (DB-auth error only). No jest moduleNameMapper added.
Concerns: Required one unanticipated config addition — `paths` in `knip.json` — to keep the knip gate green (see (e)); flagged for confirmation.
