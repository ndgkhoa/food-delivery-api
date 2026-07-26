# Phase 0 — Foundation: monorepo, catalog, minimal gateway

Context: [plan.md](./plan.md) · [architecture.md](./architecture.md)

## Overview
- **Priority**: P0 (blocks everything)
- **Status**: Not started
- **Brief**: Stand up the Nx monorepo, shared libs, `core` docker-compose profile, OpenAPI contract pipeline, and the first real E2E slice: catalog CRUD behind a minimal gateway. No auth, no events yet.

## Key insights
- Get the skeleton right once — every later phase inherits shared libs, tenancy, audit, logging.
- Introduce ONLY: Postgres + Redis + Nginx + gateway + catalog. Resist adding Kafka/ES now (YAGNI).
- Contract-first: catalog exposes an OpenAPI spec; gateway consumes a generated typed client.

## Requirements
**Functional**: CRUD restaurants + menu items; list/get endpoints; soft delete; audit-logged writes. Gateway proxies `/api/v1/catalog/*` to catalog.
**Non-functional**: `affected` build/test works; every write audit-logged + tenant-scoped; correlation ID on every log line; 12-factor config via env; compose `core` up on 16GB with room to spare.

## Architecture
- Data flow: client → Nginx → gateway (REST) → catalog (REST for now; gRPC added P2) → Postgres. Redis available for cache but wiring deferred to P3.
- Shared libs created: `shared/config`, `shared/logging`, `shared/tenancy`, `shared/audit`, `shared/errors`, `shared/contracts`, `shared/testing`.
- Multi-tenant: `tenant_id` column + interceptor reads header (`x-tenant-id`) until auth supplies it in P1.

## Related code files (to create)
- `nx.json`, `tsconfig.base.json`, root `package.json`, `.editorconfig`, `.nvmrc`, `biome.json`, `.dependency-cruiser.js`, `lefthook.yml`, `commitlint.config.mjs`, `knip.json`, `.github/pull_request_template.md`
- `apps/gateway/*` — minimal proxy + correlation ID + request logging
- `apps/catalog/*` — Nest module: restaurants + menu (controller/service/entity/repo)
- `libs/shared/config`, `libs/shared/logging`, `libs/shared/tenancy`, `libs/shared/audit`, `libs/shared/errors`, `libs/shared/testing`
- `libs/shared/contracts/catalog/openapi.yaml` + generated client
- `infra/docker-compose.yml` (profiles skeleton, `core` populated), `infra/nginx/nginx.conf`
- DB migration: `restaurants`, `menu_items`, `audit_log` (soft-delete + tenant columns)

## Implementation steps
1. `npx create-nx-workspace` (integrated, `@nx/nest` preset, pnpm). Bootstrap dev tooling (see architecture.md §8): Biome (format+lint), dependency-cruiser (module boundaries per bounded context), Lefthook (pre-commit → biome; commit-msg → commitlint w/ mandatory scope), Knip; drop in `.github/pull_request_template.md`. Base CI workflow: biome → cruiser → knip → nx affected test.
2. Generate `gateway` + `catalog` apps; create the 7 shared libs.
3. Build `shared/config` (env schema + validation), `shared/logging` (pino + correlation-ID middleware/interceptor).
4. Catalog: entities + migration (tenant_id, deleted_at, timestamps); CRUD service; soft-delete filter; audit-log hook on writes.
5. Author catalog `openapi.yaml`; wire OpenAPI Generator; gateway consumes typed client, exposes `/api/v1/catalog/*`.
6. Nginx conf: TLS (self-signed local) + proxy to gateway; add `core` compose services (Postgres 18, Redis 8, gateway, catalog, nginx).
7. Seed script: a few restaurants/menus. Smoke E2E test: list restaurants through Nginx→gateway→catalog.

## Todo
- [ ] Nx workspace (pnpm) + dev tooling: Biome, dependency-cruiser boundaries, Lefthook, Commitlint (scope required), Knip, PR template
- [ ] gateway + catalog apps scaffolded
- [ ] 7 shared libs created and imported
- [ ] config + logging + correlation ID working
- [ ] catalog CRUD + soft delete + audit log + tenant column
- [ ] OpenAPI spec → generated client used by gateway
- [ ] Nginx + `core` compose profile up
- [ ] E2E: list restaurants/menu passes

## Success criteria
- `docker compose --profile core up` runs on 16GB; `curl https://localhost/api/v1/catalog/restaurants` returns seeded data.
- Every write appears in `audit_log`; deletes set `deleted_at` and vanish from list.
- `nx affected -t build,test` works; `dependency-cruiser` fails on illegal cross-context import; `biome check` + `knip` clean.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Over-scaffolding shared libs early | M×M | Only create libs used in P0; stub others when needed |
| Nx boundary rules too strict → friction | M×L | Start permissive tags, tighten per phase |
| Self-signed TLS local pain | L×L | Document mkcert; allow HTTP fallback for dev |

## Security considerations
- No secrets in repo; `.env` gitignored; provide `.env.example`.
- Input validation via DTO + class-validator at gateway edge.
- Tenant header trusted ONLY in P0 dev; P1 replaces with JWT claim (do not ship header-trust).

## Next steps
Unblocks P1 (auth/gateway hardening) and P2 (order needs catalog gRPC). Add gRPC server to catalog in P2.
