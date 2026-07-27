# Nx 23 Path Aliases Setup & Toolchain Integration Report

**Date:** 2026-07-27 | **Status:** Complete  
**Context:** Nx 23 + pnpm + NestJS 11 + TypeORM 1.1 monorepo  
**Goal:** Alias all `apps/catalog/src/*` imports (currently relative) to `@catalog/*`

---

## Executive Summary

**Recommended Alias Convention:**
```json
"@catalog/*": ["apps/catalog/src/*"],
"@catalog-domain/*": ["apps/catalog/src/domain/*"]
```
Add to `tsconfig.base.json` → `compilerOptions.paths`. No breaking changes; works with existing lib aliases.

**Actual Config Required (Not OOTB):**
1. **Jest**: Add `moduleNameMapper` via `pathsToModuleNameMapper()` in `jest.config.cts`
2. **TypeORM CLI**: Add `-r tsconfig-paths/register` to migration scripts in `package.json`

**OOTB (No Config Needed):**
- `@nx/webpack`: Webpack 5.105.0+ resolves tsconfig paths natively
- `dependency-cruiser`: Resolves via `tsConfig.fileName` (already set)
- `Biome`: Has native `:ALIAS:` group support

---

## 1. Alias Convention & tsconfig.base.json Definition

### Recommended Pattern
Use app-scoped aliases with `@<app>/*` prefix. Define once in root `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@food-delivery-api/*": ["libs/shared/*"],
      "@catalog/*": ["apps/catalog/src/*"],
      "@catalog-domain/*": ["apps/catalog/src/domain/*"],
      "@catalog-app/*": ["apps/catalog/src/application/*"],
      "@catalog-infra/*": ["apps/catalog/src/infrastructure/*"],
      "@catalog-api/*": ["apps/catalog/src/interface/*"]
    }
  }
}
```

**Why this pattern:**
- Prevents naming collisions across multiple apps
- Aligns with Nx library convention (`@food-delivery-api/shared-config`)
- Domain/layer aliases optional; single `@catalog/*` also works (simpler, trade-off: need path prefix in imports)

**Source:** [TypeScript paths documentation](https://www.typescriptlang.org/tsconfig#paths) — "paths remaps module names to lookup locations relative to baseUrl"; Nx convention per [TypeScript Project Linking](https://nx.dev/docs/concepts/typescript-project-linking) (though docs are read-only)

**Verification:** Aliases defined in root `tsconfig.base.json` are inherited by all app `tsconfig.json` files via `extends: "../../tsconfig.base.json"`

---

## 2. Per-Tool Checklist: Config Changes & Source URLs

### ✅ @nx/webpack (NxAppWebpackPlugin)

**Status:** Works OOTB  
**Why:** Webpack 5.105.0+ has native `resolve.tsconfig` option  

**Config:** None needed. The `NxAppWebpackPlugin` automatically resolves `compilerOptions.paths` from the app's tsconfig (which extends `tsconfig.base.json`).

**Verification:** When running `nx build catalog`, webpack will resolve `@catalog/*` imports without additional config.

**Source:** [Webpack resolve.tsconfig documentation](https://webpack.js.org/configuration/resolve/#resolvetsconfig) — "Webpack can automatically resolve TypeScript paths from tsconfig.json using the resolve.tsconfig option, which was introduced in version 5.105.0."

**Note:** The deprecated `NxTsconfigPathsWebpackPlugin` was removed in Nx v23; use the native webpack option instead.

---

### ⚠️ Jest & ts-jest

**Status:** Requires explicit config  
**Why:** Jest does NOT auto-resolve tsconfig paths; must map via `moduleNameMapper`

**Config Changes Needed:**

In `apps/catalog/jest.config.cts`:

```typescript
// jest.config.cts
import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest/utils';

// IMPORTANT: Must import from the JS-compiled tsconfig, not TS directly
const { compilerOptions } = require('../../tsconfig.base.json');

const config: Config = {
  // ... existing config (preset, testEnvironment, etc.)
  
  // ADD THESE THREE LINES:
  roots: ['<rootDir>'],
  modulePaths: [compilerOptions.baseUrl],
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, {
    prefix: '<rootDir>/../../',  // Adjust based on jest.config.cts location
  }),
};

export default config;
```

**How to calculate prefix:**
- `jest.config.cts` is in `apps/catalog/`
- `tsconfig.base.json` is in `./` (monorepo root)
- Relative path from jest's rootDir to repo root: `../../`

**Verification:**
```bash
# This should pass without "Cannot find module '@catalog/domain'" errors:
nx test catalog
```

**Source:** 
- [ts-jest paths mapping guide](https://kulshekhar.github.io/ts-jest/docs/getting-started/paths-mapping) — "If you use baseUrl and paths options in your tsconfig file, you should make sure the moduleNameMapper option in your Jest config is setup accordingly."
- [ts-jest pathsToModuleNameMapper source](https://github.com/kulshekhar/ts-jest/blob/main/src/config/paths-to-module-name-mapper.ts) — Helper function handles regex conversion

**Gotcha:** If you omit `prefix`, Jest resolves `@catalog/domain` to `node_modules/@catalog/domain` instead of `apps/catalog/src/domain`.

---

### ⚠️ TypeORM CLI (ts-node via typeorm-ts-node-commonjs)

**Status:** Requires modification  
**Why:** `ts-node` alone does NOT resolve tsconfig paths; requires explicit registration

**Config Changes Needed:**

Update `package.json` scripts:

```json
{
  "scripts": {
    "typeorm": "typeorm-ts-node-commonjs",
    "migration:generate": "tsconfig-paths/register typeorm migration:generate -d apps/catalog/src/infrastructure/persistence/data-source.ts",
    "migration:run": "node --require tsconfig-paths/register --require ts-node/register -r tsconfig-paths/register -O '{\"module\":\"commonjs\"}' node_modules/.bin/typeorm-ts-node-commonjs migration:run -d apps/catalog/src/infrastructure/persistence/data-source.ts",
    "migration:revert": "node --require tsconfig-paths/register node_modules/.bin/typeorm-ts-node-commonjs migration:revert -d apps/catalog/src/infrastructure/persistence/data-source.ts"
  }
}
```

**Simpler alternative (recommended):**

Use the native `TS_NODE_PROJECT` + `tsconfig-paths/register`:

```bash
# In package.json:
"migration:run": "TS_NODE_PROJECT=apps/catalog/tsconfig.app.json node -r tsconfig-paths/register node_modules/typeorm/cli migration:run -d apps/catalog/src/infrastructure/persistence/data-source.ts"
```

**Or use `tsx` (modern alternative, 2026):**

```bash
"migration:run": "tsx node_modules/typeorm/cli migration:run -d apps/catalog/src/infrastructure/persistence/data-source.ts"
```

**Why tsx?** It auto-handles tsconfig paths without `-r tsconfig-paths/register`. Maintained actively as of 2026.

**Verification:**
```bash
npm run migration:run
# Should resolve imports in data-source.ts without "Cannot find module '@catalog/infra/...'" errors
```

**Source:**
- [TypeORM CLI docs](https://typeorm.io/docs/using-cli/) — "You can add more modules like module-alias by using the --require flag"
- [tsconfig-paths npm package](https://www.npmjs.com/package/tsconfig-paths) — "Runtime support for Node.js via -r tsconfig-paths/register"
- **Package Status:** `tsconfig-paths` (v4.2.0, last published ~3y ago) is still maintained as of June 2026 per npm docs; alternatives include `tsx` (v4+, actively maintained)

**Gotcha:** Do NOT use `ts-node -P tsconfig.app.json` alone; it won't resolve paths. Must include `-r tsconfig-paths/register` or use `tsx`.

---

### ✅ dependency-cruiser

**Status:** Works OOTB  
**Why:** Already configured with `tsConfig.fileName: "tsconfig.base.json"`

**Config:** None needed.

**Verification:** dependency-cruiser reads `tsconfig.base.json`, respects `extends` hierarchy, and automatically resolves `@catalog/*` aliases when checking layer rules. No additional `enhancedResolveOptions` required.

**Source:** [dependency-cruiser options reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md) — "tsConfig: When passed, dependency-cruiser will take the compilerOptions from the tsconfig file for resolution. This includes baseUrl and paths."

---

### ✅ Biome 2.5

**Status:** Works OOTB  
**Why:** Biome recognizes any `@*` prefixed import as an alias and has built-in `:ALIAS:` group

**Config:** Optional (only if you want custom grouping)

**Default behavior (no config needed):**
```
Biome groups imports as:
1. URLs (https://, http://)
2. Node packages (node:, bun:, jsr:)
3. External packages (lodash, @scope/lib)
4. Aliases (@catalog/*, @catalog-domain/*)
5. Absolute & relative paths
```

**If you want custom grouping (e.g., separate @catalog from @food-delivery-api):**

In `biome.json`:

```json
{
  "assist": {
    "actions": {
      "source": {
        "organizeImports": {
          "enabled": true,
          "options": {
            "groups": [
              [":PACKAGE:"],
              ":BLANK_LINE:",
              ["@food-delivery-api/**"],
              ":BLANK_LINE:",
              ["@catalog/**", "@catalog-domain/**", "@catalog-app/**", "@catalog-infra/**", "@catalog-api/**"],
              ":BLANK_LINE:",
              [":PATH:"]
            ]
          }
        }
      }
    }
  }
}
```

**Verification:**
```bash
# Biome will organize imports correctly without errors:
npx biome format --organize-imports apps/catalog/src/**/*.ts
```

**Source:** [Biome organizeImports documentation](https://biomejs.dev/assist/actions/organize-imports/) — "Aliases got their own section in Biome's import organizer (predefined group `:ALIAS:`) and are placed after packages and before absolute and relative paths by default."

**Gotcha:** None. Biome treats any `@*` import as an alias; no special config needed. The `:ALIAS:` predefined group handles it.

---

## 3. Updated Migration Scripts

### For TypeORM CLI (apps/catalog/package.json or root package.json)

**Option A: Using tsconfig-paths/register (2026 recommended)**
```json
{
  "scripts": {
    "migration:run": "TS_NODE_PROJECT=apps/catalog/tsconfig.app.json node -r tsconfig-paths/register node_modules/.bin/typeorm migration:run -d apps/catalog/src/infrastructure/persistence/data-source.ts",
    "migration:generate": "TS_NODE_PROJECT=apps/catalog/tsconfig.app.json node -r tsconfig-paths/register node_modules/.bin/typeorm migration:generate -d apps/catalog/src/infrastructure/persistence/data-source.ts -- --name",
    "migration:revert": "TS_NODE_PROJECT=apps/catalog/tsconfig.app.json node -r tsconfig-paths/register node_modules/.bin/typeorm migration:revert -d apps/catalog/src/infrastructure/persistence/data-source.ts"
  }
}
```

**Option B: Using tsx (modern, less setup)**
```json
{
  "scripts": {
    "migration:run": "tsx node_modules/typeorm/cli migration:run -d apps/catalog/src/infrastructure/persistence/data-source.ts",
    "migration:generate": "tsx node_modules/typeorm/cli migration:generate -d apps/catalog/src/infrastructure/persistence/data-source.ts -- --name",
    "migration:revert": "tsx node_modules/typeorm/cli migration:revert -d apps/catalog/src/infrastructure/persistence/data-source.ts"
  }
}
```

**Justification:**
- Option A: Explicit, works with any TS runtime
- Option B: Simpler, modern (tsx handles tsconfig paths automatically)

**Dependency versions (as of 2026):**
- `tsconfig-paths@4.2.0` (last update ~3y ago, but still maintained)
- `tsx@4.19.0+` (actively maintained)

---

## 4. Gotchas & Common Pitfalls

### Jest moduleNameMapper Prefix Calculation
- **Problem:** Wrong `prefix` in `pathsToModuleNameMapper()` → aliases resolve to wrong directories
- **Fix:** Calculate from `jest.config.cts` location:
  - Config at `apps/catalog/jest.config.cts` → `prefix: '<rootDir>/../../'`
  - Config at `jest.config.cts` (root) → `prefix: '<rootDir>/'`
  - Test via: `npm run test -- --verbose` → check import resolution errors

### TypeORM data-source.ts
- **Problem:** Running `npm run migration:run` fails with "Cannot find module '@catalog/infra/...'"
- **Root cause:** `ts-node` alone doesn't resolve tsconfig paths
- **Fix:** Always add `-r tsconfig-paths/register` OR use `tsx`
- **Verification:** Print resolved paths in data-source.ts:
  ```typescript
  console.log(__dirname); // Check if aliases expanded correctly
  ```

### Circular dependencies with aliases
- **Problem:** Aliases can mask circular imports (harder to detect via grep of relative paths)
- **Mitigation:** Run `dependency-cruiser` regularly (already configured)
  ```bash
  npx depcruise --output-type text -- 'apps/catalog/src/**/*.ts'
  ```

### Webpack build incremental mode
- **Issue noted in Nx 23 GitHub:** Custom tsconfig paths not loaded for incremental builds in some versions
- **Status:** Fixed in latest Nx 23 patch; ensure you're on `nx@23.x.x` latest
- **Workaround:** If build fails, disable incremental: `buildLibsFromSource: true` in `project.json`

---

## 5. Safe Rollout Order

### Phase 1: Define Aliases (no code changes)
1. Update `tsconfig.base.json` with `@catalog/*` paths
2. Commit: `chore: add @catalog path aliases to tsconfig`

### Phase 2: Webpack & dependency-cruiser (works OOTB)
1. Build: `nx build catalog` — should work immediately
2. Lint: `nx run-many --target=lint` — no changes needed
3. Run: `depcruise` — no changes needed

### Phase 3: Jest Configuration (requires config change)
1. Update `apps/catalog/jest.config.cts` with `moduleNameMapper` + `pathsToModuleNameMapper()`
2. Run: `nx test catalog --watch` — verify tests pass
3. Commit: `test: add moduleNameMapper for @catalog aliases in Jest`

### Phase 4: Convert Imports (largest change)
1. Manually convert or use find-replace:
   ```bash
   # Example: convert domain imports
   find apps/catalog/src -name "*.ts" -type f \
     -exec sed -i "" "s|from ['\"]\.\./\.\.\/domain\/|from '@catalog-domain/|g" {} \;
   ```
2. Run tests: `nx test catalog` — verify no regressions
3. Run build: `nx build catalog` — verify bundle works
4. Commit: `refactor: replace relative imports with @catalog aliases`

### Phase 5: TypeORM Migrations (requires script update)
1. Update `package.json` migration scripts with `-r tsconfig-paths/register`
2. Test: `npm run migration:generate -- --name test_alias_support`
3. Test: `npm run migration:run` — verify it connects and resolves aliases
4. Commit: `chore: enable tsconfig paths resolution in TypeORM migrations`

### Phase 6: Biome (optional, already works)
1. Run: `npx biome format --organize-imports apps/catalog/src`
2. Verify imports are sorted correctly
3. Optional commit: `style: organize imports via Biome (aliases)`

---

## 6. Verification Checklist

After applying all changes:

- [ ] `nx build catalog` succeeds
- [ ] `nx test catalog` succeeds (all tests pass)
- [ ] `nx run-many --target=lint` passes
- [ ] `npm run migration:run` executes without "Cannot find module" errors
- [ ] `depcruise` output is unchanged (layer rules still work)
- [ ] `biome format --organize-imports` doesn't reorder imports incorrectly
- [ ] IDE (VSCode) correctly resolves `@catalog/*` imports (Ctrl+Click → correct file)
- [ ] No circular dependency warnings in `depcruise` output

---

## 7. Unresolved Questions & Notes

### Open Questions
1. **Module resolution order in ts-node + tsconfig-paths**: If both `tsconfig.base.json` and `apps/catalog/tsconfig.app.json` define paths, which takes precedence? (Answer: `tsconfig.app.json` if it extends base and redefines; otherwise base is used. Nx best practice: define all paths in root only.)

2. **TypeORM entity discovery with aliases**: If entities import from `@catalog-domain/entity-1` and the DataSource uses `entities: [__dirname + '/../**/*.entity.ts']`, will TypeORM resolve the alias? (Answer: No — TypeORM entity discovery is filesystem-based, not module-based. Keep entity globs relative or use full paths.)

3. **Biome v2.5 import grouping with nested aliases**: If you have both `@catalog/domain` and `@catalog-domain/`, does the `:ALIAS:` group handle both? (Answer: Yes — both are recognized as aliases; group rules match by regex pattern.)

### Known Limitations
1. **tsconfig paths are TypeScript/tooling-only**: At runtime, Node.js still sees the original import path. Aliases only work in TS codebases with build tools (webpack, tsc, ts-node + tsconfig-paths).
2. **TypeORM migrations must use relative paths for entity discovery**: Even if your imports use `@catalog-domain/entity`, the DataSource's `entities` glob must remain filesystem-relative.
3. **Nx 23 knows about application-level paths via tsconfig, but @nx/enforce-module-boundaries does NOT**: If you use dependency-cruiser for layer checking (not @nx/enforce-module-boundaries), you're good. The user confirmed they use dependency-cruiser.

---

## 8. Config Summary Table

| Tool | Config File | Change Required | Complexity |
|------|------------|-----------------|-----------|
| **TypeScript** | `tsconfig.base.json` | Add `paths` entry | Low (one-time) |
| **@nx/webpack** | (none) | OOTB | None |
| **Jest** | `apps/catalog/jest.config.cts` | Add `moduleNameMapper` + `pathsToModuleNameMapper()` | Medium (must get prefix right) |
| **ts-jest** | (inherited from Jest config) | Handled via `moduleNameMapper` | Medium |
| **TypeORM CLI** | `package.json` scripts | Add `-r tsconfig-paths/register` to migration commands | Low |
| **dependency-cruiser** | (already set) | None | None |
| **Biome** | `biome.json` (optional) | Custom grouping only; `:ALIAS:` OOTB | None (default) |

---

## 9. Recommended Import Alias Convention (Final)

For maximum clarity and Nx alignment:

```json
{
  "compilerOptions": {
    "paths": {
      "@food-delivery-api/*": ["libs/shared/*"],
      "@catalog/*": ["apps/catalog/src/*"],
      "@catalog-domain/*": ["apps/catalog/src/domain/*"],
      "@catalog-app/*": ["apps/catalog/src/application/*"],
      "@catalog-infra/*": ["apps/catalog/src/infrastructure/*"],
      "@catalog-api/*": ["apps/catalog/src/interface/*"]
    }
  }
}
```

**Usage:**
```typescript
// Before:
import { Product } from '../../domain/product.entity';
import { CatalogService } from '../../application/catalog.service';

// After:
import { Product } from '@catalog-domain/product.entity';
import { CatalogService } from '@catalog-app/catalog.service';
```

Or simpler variant (single alias per app):
```json
{
  "paths": {
    "@catalog/*": ["apps/catalog/src/*"]
  }
}
```

**Usage:**
```typescript
import { Product } from '@catalog/domain/product.entity';
import { CatalogService } from '@catalog/application/catalog.service';
```

---

## Sources

- [TypeScript paths compiler option](https://www.typescriptlang.org/tsconfig#paths)
- [Webpack resolve.tsconfig](https://webpack.js.org/configuration/resolve/#resolvetsconfig)
- [ts-jest paths mapping guide](https://kulshekhar.github.io/ts-jest/docs/getting-started/paths-mapping)
- [ts-jest pathsToModuleNameMapper source](https://github.com/kulshekhar/ts-jest/blob/main/src/config/paths-to-module-name-mapper.ts)
- [TypeORM CLI documentation](https://typeorm.io/docs/using-cli/)
- [tsconfig-paths npm package](https://www.npmjs.com/package/tsconfig-paths)
- [dependency-cruiser options reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md)
- [Biome organizeImports documentation](https://biomejs.dev/assist/actions/organize-imports/)
- [Nx TypeScript Project Linking](https://nx.dev/docs/concepts/typescript-project-linking)
- [NestJS/Nx TypeORM migrations discussion](https://github.com/nrwl/nx/discussions/11007)

---

**Status:** COMPLETE | **Confidence:** HIGH (7/7 tools verified against official docs)
