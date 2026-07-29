# Dev-Tooling Versions & Usage Audit | NestJS + Nx + pnpm Monorepo
**Date:** 2026-07-26 | **Target:** Node 24 LTS, TypeScript, macOS arm64

---

## 1. Tool Versions & Installation Matrix

| Tool | Latest Ver | Install Method | arm64? | 1-Line Usage | Source URL |
|------|-----------|-----------------|--------|-------------|------------|
| **Biome** (@biomejs/biome) | 2.5.5 | `npm i -D @biomejs/biome` | ✅ Yes (npm binaries) | `biome check --write` (format+lint+imports in one) | [npmjs.com/@biomejs/biome](https://www.npmjs.com/package/@biomejs/biome) |
| **Lefthook** | 2.1.10 | `npm i lefthook` OR `brew install lefthook` | ✅ Yes (brew) | `lefthook run pre-commit` | [npmjs.com/lefthook](https://www.npmjs.com/package/lefthook) |
| **lint-staged** | 17.2.0 | `npm i -D lint-staged` | N/A (JS) | `lint-staged` (legacy, in Husky hooks) | [npmjs.com/lint-staged](https://www.npmjs.com/package/lint-staged) |
| **Commitlint** (@commitlint/cli) | 21.2.1 | `npm i -D @commitlint/cli @commitlint/config-conventional` | N/A (JS) | `commitlint --edit $1` (via Lefthook commit-msg hook) | [npmjs.com/@commitlint/cli](https://www.npmjs.com/package/@commitlint/cli) |
| **Knip** | 6.29.0 | `npm i -D knip` | N/A (JS) | `knip` (scan dead code & unused deps) | [npmjs.com/knip](https://www.npmjs.com/package/knip) |
| **dependency-cruiser** | 18.1.0 | `npm i -D dependency-cruiser` | N/A (JS) | `depcruise --validate .dependency-cruiser.js` (enforces module boundaries) | [npmjs.com/dependency-cruiser](https://www.npmjs.com/package/dependency-cruiser) |
| **Scalar** (@scalar/nestjs-api-reference) | 1.2.10 | `npm i @scalar/nestjs-api-reference` | N/A (JS) | Import & register as NestJS module for OpenAPI UI | [npmjs.com/@scalar/nestjs-api-reference](https://www.npmjs.com/package/@scalar/nestjs-api-reference) |
| **Bruno** (@usebruno/cli) | 4.0.0 | `npm i -D @usebruno/cli` | N/A (JS) | `bruno run .bru --env prod` (run API test collections in CI) | [npmjs.com/@usebruno/cli](https://www.npmjs.com/package/@usebruno/cli) |
| **Trivy** | 0.72.0 | `docker pull aquasec/trivy:latest` OR `brew install trivy` | ✅ Yes (via docker/brew) | `trivy image --severity HIGH nginx:latest` (scan images/fs/config) | [github.com/aquasecurity/trivy/releases](https://github.com/aquasecurity/trivy/releases) |
| **Hadolint** | 2.14.0 | `brew install hadolint` OR docker | ✅ Yes (brew) | `hadolint Dockerfile` (lint Dockerfile for best practices) | [github.com/hadolint/hadolint](https://github.com/hadolint/hadolint) |
| **actionlint** | v1.7.12+ | `brew install actionlint` OR `go install github.com/rhysd/actionlint@latest` | ✅ Yes (brew/binary) | `actionlint .github/workflows/*.yml` (lint GH Actions workflows) | [github.com/rhysd/actionlint](https://github.com/rhysd/actionlint) |
| **Changesets** (@changesets/cli) | 2.31.0 | `npm i -D @changesets/cli` | N/A (JS) | `changeset` (manage changelog + versioning per Nx project) | [npmjs.com/@changesets/cli](https://www.npmjs.com/package/@changesets/cli) |
| **pnpm** | 10.30.2 | `corepack enable pnpm` (Node 24 has corepack built-in) | N/A (package manager) | `pnpm install` (3x faster lockfile + monorepo workspace resolution) | [pnpm.io/installation](https://pnpm.io/installation) |
| **Renovate** (vs Dependabot) | 37.x+ | GitHub App (install from App Marketplace) | N/A (cloud service) | Config: `renovate.json` at repo root (monorepo-aware grouping) | [github.com/renovatebot/renovate](https://github.com/renovatebot/renovate) |

---

## 2. Redundancy & Conflict Analysis

### **Lefthook vs lint-staged: DROP lint-staged**
- **Status:** Lefthook makes lint-staged redundant. Lefthook v2.1.10 natively supports `{staged_files}` placeholder + `stage_fixed: true` flag.
- **Action:** Remove `lint-staged` from devDependencies. Configure Biome + Commitlint directly in `lefthook.yml` with staged file targeting.
- **Why:** Single tool, fewer dependencies, no Husky coupling.

### **Biome + dependency-cruiser: Boundary Gap Remains**
- **Biome (v2.5.5):** Does NOT support type-aware linting or module-boundary enforcement (i.e., "forbid imports from `@app/api` → `@app/db`").
- **dependency-cruiser (v18.1.0):** Sole tool for enforcing Clean Architecture rules. Cannot be replaced by Biome.
- **Action:** Keep both. Biome = format/lint. dependency-cruiser = architecture validation.
- **Note:** dependency-cruiser can generate `.dependency-cruiser.js` rules that enforce forbidden cross-context imports.

### **Knip vs dependency-cruiser vs Nx: Scope Overlap**
- **Knip (v6.29.0):** Finds unused dependencies, exports, files. Detects unlisted & duplicate deps. Builds full module graph from entry points.
- **dependency-cruiser (v18.1.0):** Analyzes deps to enforce architectural rules (not designed for dead-code detection).
- **Nx:** Has built-in dependency graph (`nx dep-graph`), but does NOT remove module-boundary enforcement requirement.
- **Action:** Keep Knip for dead-code cleanup. Use dependency-cruiser for architecture. Nx graph is informational only.

### **Renovate vs Dependabot: CHOOSE RENOVATE for monorepo**
- **Dependabot:** Zero-config GitHub native. Poor monorepo support (limited grouping, no workspace-aware updates).
- **Renovate (v37.x+):** 90+ package managers, monorepo-aware grouping, Docker/pnpm-catalog support, GitLab/Bitbucket/Azure.
- **Decision:** For Nx + pnpm monorepo: **Renovate is mandatory.** Renovate groups internal deps correctly, updates pnpm-catalog once (not per workspace).
- **Config:** `renovate.json` (not `.github/dependabot.yml`).

### **Trivy Supply Chain Note (March 2026 Incident)**
- **Critical:** aquasecurity/trivy-action was compromised 2026-03-19. Safe versions: Trivy v0.69.3, trivy-action v0.35.0+, setup-trivy v0.2.6.
- **Current v0.72.0:** Safe to use. Pin GitHub Actions to commit SHA, not tag.

---

## 3. Minimal Config File List

Create these files in project root:

| File | Purpose |
|------|---------|
| **biome.json** | Format + lint config; extends linter rules (imports org, patterns) |
| **lefthook.yml** | Git hooks manager; pre-commit (Biome), commit-msg (Commitlint), pre-push (Knip+cruiser) |
| **commitlint.config.js** | Conventional commit rules; extend `@commitlint/config-conventional` |
| **.dependency-cruiser.js** | Module boundary rules; forbid cross-context imports (e.g., api → db) |
| **knip.json** | Dead-code scan config; entry points, ignore patterns |
| **.trivyignore** | Trivy vulnerability suppression (optional; CVE + duration) |
| **.hadolint.yaml** | Dockerfile lint rules; ignore specific violations (optional) |
| **renovate.json** | Dependency update policy; grouping, automerge rules, pnpm-catalog awareness |
| **pnpm-workspace.yaml** | (already exists) Workspace package discovery |
| **.actionlintrc.yaml** | GitHub Actions lint config (optional; most defaults work) |

---

## 4. Nx Integration Notes

- **Biome:** No official `@nx/biome` plugin. Run `biome check` directly via `nx exec` or npm scripts.
- **dependency-cruiser:** Run via `nx run-many --target=lint:cruiser` after creating target in `project.json`.
- **Knip:** Run via `nx exec knip` (treats Nx workspace as mono).
- **Trivy:** Run in CI (`trivy image`, `trivy fs`) — not integrated with Nx.
- **Changesets:** Works with Nx projects if each has `package.json`. Use for changelog + version bumps per project.

---

## 5. Monorepo Workflow: Recommended Hook Chain (lefthook.yml)

```yaml
# Pseudo-config structure:
pre-commit:
  commands:
    biome: biome check --write {staged_files}
    stage_fixed: true

commit-msg:
  commands:
    commitlint: commitlint --edit $1

pre-push:
  commands:
    knip: knip --reporter json
    cruiser: depcruise --validate .dependency-cruiser.js src/
```

---

## 6. GitHub Actions: CI Tooling

- **Trivy Image Scan:** Use action v0.35.0+ (post-compromise). Pin to commit SHA.
  - `aquasecurity/trivy-action@<commit-sha>`
- **Hadolint:** Use community action or Docker image (`hadolint/hadolint:latest-alpine`).
- **actionlint:** Use GH Marketplace action or standalone binary.

---

## Unresolved Items

1. **Biome Nx Plugin Status:** No official `@nx/biome` plugin listed. Confirm if upcoming or expected to remain uncoupled.
2. **Changesets with Private Packages:** Does Changesets work correctly with Nx monorepo where packages are never published to npm? (Assumed yes for changelog + versioning, but untested in this stack.)
3. **dependency-cruiser Graphviz Requirement:** Does graph generation require graphviz system dependency, or is it optional? (For visualization only; rule enforcement works without it.)
4. **actionlint unsigned binary macOS:** Docs note executable is unsigned; confirm user impact on CI (GitHub Actions runners skip this).
5. **Trivy Binary arm64 macOS:** Confirmed available via Homebrew; direct binary availability from GitHub releases not visible in asset list truncation.
6. **pnpm-catalog + Renovate Integration:** Verify Renovate v37.x correctly deduplicates updates to `.pnpm-workspaces.yaml` across all workspace dependents.

---

**Sources Cited:**
- [Biome Official Docs](https://biomejs.dev)
- [Lefthook GitHub Releases](https://github.com/evilmartians/lefthook/releases)
- [dependency-cruiser npm](https://www.npmjs.com/package/dependency-cruiser)
- [Trivy Releases & Incident Report](https://github.com/aquasecurity/trivy/releases)
- [Renovate Documentation](https://docs.renovatebot.com)
- [actionlint Install Guide](https://github.com/rhysd/actionlint/blob/main/docs/install.md)
- [pnpm Installation](https://pnpm.io/installation)
