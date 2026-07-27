# Per-Service Architecture — Clean / Hexagonal (Ports & Adapters)

Authoritative internal layout for EVERY `apps/<service>`. Catalog is the reference implementation. Context: [architecture.md](./architecture.md) · [development-workflow.md](./development-workflow.md).

## Why

Domain logic must not depend on frameworks or IO (TypeORM, Kafka, HTTP). This keeps business rules testable in isolation and lets CQRS / Outbox / Saga plug into `infrastructure` without touching `domain`. Full separation: domain models are plain classes, ORM entities are separate, mappers translate between them.

## Layers & dependency direction (inward only)

```
interface ──▶ application ──▶ domain ◀── infrastructure
                                 ▲                 │
                                 └── implements ports ┘
```

- **domain** — pure TypeScript. Models (plain classes, invariants via factory), repository PORTS (interfaces + DI tokens), domain events, value objects. NO imports of `@nestjs/*`, `typeorm`, or other layers.
- **application** — use cases orchestrating the domain through ports. Organised as `commands/` (write) and `queries/` (read) = structural CQRS. Plain `@Injectable()` handlers (no `@nestjs/cqrs` bus yet — added when the Kafka read-model lands). Imports `domain` only.
- **infrastructure** — ADAPTERS that implement domain ports: TypeORM ORM-entities, repositories, mappers, migrations, data-source; audit adapter; tenancy (ALS) adapter + interceptor. Imports `domain` (ports/models it implements). Never imports `interface`.
- **interface** — delivery layer: HTTP controllers, request/response DTOs (class-validator), mappers domain→response. Imports `application` (+ `domain` types). Never imports `infrastructure`.
- **composition root** — `app.module.ts` + `main.ts` wire ports→adapters and register handlers/controllers. EXEMPT from layer rules (they may import every layer).

## Target tree (catalog)

```
apps/catalog/src/
├── main.ts
├── app.module.ts                         # composition root
├── domain/
│   ├── restaurant/ restaurant.ts · restaurant.repository.ts
│   ├── menu-item/  menu-item.ts · menu-item.repository.ts
│   └── shared/ tenant-context.port.ts · audit.port.ts · audit-action.ts · pagination.ts
├── application/
│   ├── restaurant/ commands/{create,update,delete}-restaurant.handler.ts · queries/{list,get}-restaurants.handler.ts
│   └── menu-item/  commands/… · queries/…
├── infrastructure/
│   ├── persistence/ entities/*.orm-entity.ts · mappers/*.mapper.ts · repositories/typeorm-*.repository.ts · migrations/ · data-source.ts · persistence.module.ts
│   ├── audit/ typeorm-audit.adapter.ts · audit.module.ts
│   └── tenancy/ als-tenant-context.adapter.ts · tenant-context.interceptor.ts · tenancy.module.ts
└── interface/http/ *.controller.ts · dto/*.request.ts · dto/*.response.ts · mappers/*.mapper.ts
```

## Conventions

- **Domain model**: private constructor + static `create(props)` (enforces invariants, returns model) and `reconstitute(props)` (rehydrate from persistence, no validation). Readonly getters. Prices stay integer cents.
- **Port**: `export interface RestaurantRepository { … }` + `export const RESTAURANT_REPOSITORY = Symbol('RestaurantRepository')`; adapters bound to the token in the infra module; handlers `@Inject(RESTAURANT_REPOSITORY)`.
- **Mapper**: static `toDomain(orm)` / `toOrm(domain)`.
- **DI wiring**: infra modules `provide` each port token with its adapter `useClass`. `app.module` imports infra modules + registers application handlers (providers) + controllers.
- Filenames kebab-case; `import` (not `import type`) for anything NestJS needs at runtime (injected classes, `@Body` DTOs). No `phase` token anywhere.
- **Path aliases (mandatory)**: NO relative imports for in-app modules — use the per-service alias `@<service>/*` → `apps/<service>/src/*` (e.g. `@catalog/domain/...`), defined in `tsconfig.base.json` `paths`. Cross-service is forbidden anyway (cruiser); libs use `@food-delivery-api/*`. Jest/webpack/cruiser resolve these OOTB (Nx). TypeORM CLI migrations run via **tsx** with `--tsconfig tsconfig.base.json` (shared `typeorm` base script in `package.json`) so aliases resolve at CLI runtime — no ts-node/tsconfig-paths needed.

## Test strategy (faster + layered)

- **domain** — pure unit tests, no DB (invariants, factories).
- **application** — unit tests with in-memory fake repositories (no DB) → fast.
- **infrastructure repositories/mappers** — integration tests via testcontainers Postgres.
- **interface** — the existing black-box e2e (`apps/catalog-e2e`, full app + testcontainers) stays as-is behaviourally.

## dependency-cruiser layer rules (enforced)

Added to `.dependency-cruiser.js` (composition root `app.module.ts` / `main.ts` exempt):
- `domain` → `application|infrastructure|interface` : forbidden
- `application` → `infrastructure|interface` : forbidden
- `interface` → `infrastructure` : forbidden
- plus existing: no-circular, no-cross-app-imports, no-lib-importing-app.

## Open questions

- Introduce `@nestjs/cqrs` command/query bus when the Kafka-backed read model arrives (deferred, YAGNI now).
- Domain events emission wired with Outbox in the event-driven slice (deferred).
