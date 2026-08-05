# Code Standards & Conventions

Codebase-wide standards for architecture, naming, commit messages, testing, and quality gates.

## Architectural Patterns

### Hexagonal (Ports & Adapters) Layering

Every service follows the same internal structure to ensure consistency and enforceability:

```
src/
├── domain/                  # Business logic; pure TypeScript (no framework)
│   ├── {aggregate}/         # Entity roots (e.g., Order, Restaurant)
│   │   ├── {entity}.aggregate.ts
│   │   ├── {entity}.value-object.ts
│   │   └── events/          # Domain events
│   ├── services/            # Domain services (multi-aggregate logic)
│   ├── repositories/        # Port (abstract interface)
│   │   └── {entity}.repository.ts (interface only)
│   └── ports/               # Abstract adapters
│       └── {adapter}.port.ts
│
├── application/             # Use cases; orchestrates domain
│   ├── commands/            # CQRS write handlers
│   │   ├── {command}.handler.ts
│   │   └── {command}.dto.ts
│   ├── queries/             # CQRS read handlers
│   │   ├── {query}.handler.ts
│   │   └── {query}.dto.ts
│   ├── services/            # Application services (commands/queries)
│   └── dto/                 # Input/output models
│
├── infrastructure/          # Framework & external adapters
│   ├── persistence/         # TypeORM (adapter impl of repository ports)
│   │   ├── entities/        # ORM entities (must match domain aggregates)
│   │   ├── repositories/    # Repository implementations
│   │   └── migrations/      # TypeORM migrations
│   ├── messaging/           # Kafka producers/consumers
│   │   ├── {topic}.producer.ts
│   │   └── {topic}.consumer.ts
│   ├── external/            # HTTP/gRPC clients, third-party integrations
│   ├── outbox/              # Transactional outbox (if applicable)
│   ├── queue/               # BullMQ job processors
│   ├── grpc/                # gRPC stubs & clients
│   ├── redis/               # Redis clients & adapters
│   └── temporal/            # Temporal workflow/activity definitions
│
├── interface/               # Entry points (NestJS Controllers, gRPC services)
│   ├── http/
│   │   ├── {feature}.controller.ts
│   │   ├── mappers/         # Request/Response mappers
│   │   └── dto/             # Controller-specific DTOs
│   ├── grpc/
│   │   └── {service}.service.ts
│   ├── messaging/           # Kafka consumers as consumers
│   └── cli/                 # CLI commands (if applicable)
│
├── config/                  # NestJS config module
│   └── {service}.config.ts
│
├── testing/                 # Test fixtures, factories, mocks
│   ├── factories/
│   └── fixtures/
│
└── main.ts                  # Application bootstrap
```

**Dependency Direction:** Domain → Application → Infrastructure ← Interface
- Domain is pure (no framework, easy to test, reusable)
- Application orchestrates domain & infrastructure
- Infrastructure implements domain ports
- Interface depends on infrastructure but NOT on domain (for decoupling & testability)

### CQRS (Command Query Responsibility Segregation)

**Commands** (writes) and **Queries** (reads) are separated:

```typescript
// Command (write)
export class PlaceOrderCommand {
  constructor(
    public readonly customerId: string,
    public readonly restaurantId: string,
    public readonly items: OrderItem[]
  ) {}
}

export class PlaceOrderHandler {
  async execute(command: PlaceOrderCommand): Promise<OrderId> {
    // Load aggregate, apply command, publish events, save
  }
}

// Query (read)
export class ListOrdersQuery {
  constructor(public readonly customerId: string) {}
}

export class ListOrdersHandler {
  async execute(query: ListOrdersQuery): Promise<OrderDto[]> {
    // Read from read-model or projection (no side effects)
  }
}
```

**Benefits:**
- Clear intent (write vs. read)
- Easier to scale independently
- Read-model can be eventual consistency

### Saga Orchestration (Order Service Only)

Order saga coordinates distributed transactions across multiple services:

```typescript
export class OrderSagaOrchestrator {
  async execute(command: PlaceOrderCommand): Promise<Order> {
    // Step 1: Reserve stock (inventory gRPC)
    const reservation = await this.inventoryService.reserve(...);
    if (!reservation.success) {
      return { status: 'CANCELLED' }; // Compensation implicit
    }

    // Step 2: Charge payment (Temporal workflow)
    const charge = await this.paymentOrchestrator.charge(...);
    if (!charge.success) {
      await this.inventoryService.release(...); // Explicit compensation
      return { status: 'CANCELLED' };
    }

    // Step 3: Assign driver
    await this.deliveryService.assign(...); // No compensation (soft state)

    return { status: 'CONFIRMED' };
  }
}
```

**Compensation Strategies:**
- **Implicit:** Revert state in domain (e.g., set order.status = CANCELLED)
- **Explicit:** Call reverse operations (e.g., inventory.release())
- **Saga Reaper:** Background job re-drives stalled sagas with exponential backoff

### Transactional Outbox Pattern

Catalog writes to both domain entity and outbox in a single transaction:

```typescript
// In Catalog service
async createRestaurant(command: CreateRestaurantCommand): Promise<Restaurant> {
  return this.transactionManager.run(async (em) => {
    const restaurant = new Restaurant(...);
    await em.save(restaurant);

    // Same transaction
    const outboxEvent = new OutboxEvent({
      aggregateId: restaurant.id,
      eventType: 'restaurant_created',
      payload: { name: restaurant.name, ... },
    });
    await em.save(outboxEvent);

    return restaurant;
  });
}
```

Debezium CDC polls outbox table and streams to Kafka `catalog.events` topic.

**Benefits:**
- No dual-write failures (atomic write or fail)
- Order preserved (Debezium maintains LSN order)
- Exactly-once semantics via processed_events table in consumers

### Exactly-Once Semantics

All Kafka consumers ensure exactly-once delivery via idempotency:

```typescript
export class CatalogEventsConsumer {
  async consume(event: CatalogEvent): Promise<void> {
    // Check if already processed
    const processed = await this.processedEventsRepo.findOne({
      eventId: event.id,
      consumerId: 'search_index_builder',
    });
    if (processed) {
      return; // Idempotent: skip
    }

    // Process event
    await this.elasticsearchService.indexRestaurant(event.payload);

    // Record processing
    await this.processedEventsRepo.save({
      eventId: event.id,
      consumerId: 'search_index_builder',
      processedAt: new Date(),
    });
  }
}
```

## File Naming Conventions

### TypeScript/JavaScript Files

- **Aggregates & Entities:** `{entity-name}.aggregate.ts`, `{entity-name}.orm-entity.ts`
- **Value Objects:** `{name}.value-object.ts`
- **Controllers:** `{feature}.controller.ts`
- **Services:** `{feature}.service.ts`
- **Repositories:** `{entity}.repository.ts`, `{entity}-read.repository.ts`
- **Handlers (CQRS):** `{command-or-query-name}.handler.ts`
- **Decorators:** `{decorator-name}.decorator.ts`
- **Filters:** `{filter-name}.filter.ts`
- **Guards:** `{guard-name}.guard.ts`
- **Interceptors:** `{interceptor-name}.interceptor.ts`
- **Middleware:** `{middleware-name}.middleware.ts`
- **Consumers (Kafka):** `{topic-name}.consumer.ts`
- **Producers (Kafka):** `{topic-name}.producer.ts`
- **Modules:** `{feature}.module.ts`
- **Config:** `{service-name}.config.ts`
- **Factories:** `{name}.factory.ts`
- **Adapters:** `{adapter-name}.adapter.ts`

### Test Files

- **Unit Tests:** `{filename}.spec.ts`
- **Integration Tests:** `{feature}.e2e.spec.ts` (in *-e2e project)
- **Test Fixtures:** `{feature}.fixture.ts`
- **Test Factories:** `{entity}.factory.ts` (in testing/ folder)

### Markdown & Configuration

- Use **kebab-case** for documentation files: `deployment-guide.md`, `code-standards.md`
- Use **UPPERCASE** for environment files: `.env`, `.env.example`
- Use **camelCase** for JSON config keys: `packageManager`, `defaultBase` (in nx.json)

### General Rules

1. **Use kebab-case for file names** — Easier for shell scripts and grepping
2. **Use PascalCase for class/interface names** — TypeScript convention
3. **Use camelCase for functions, properties, variables** — TypeScript convention
4. **Avoid single-letter filenames** — Reduces ambiguity in searches
5. **Include the full term in filenames** — Don't abbreviate (e.g., `restaurant` not `rest`, `controller` not `ctrl`)

## Naming Conventions

### Classes & Interfaces

```typescript
// Entity/Aggregate
export class Order {
  id: OrderId;
  status: OrderStatus;
  items: OrderItem[];
}

// Value Object
export class OrderId extends ValueObject<string> {
  constructor(public readonly value: string) { super(); }
}

// Service
export class OrderService { }

// Handler (CQRS)
export class PlaceOrderHandler implements IQueryHandler<PlaceOrderCommand> { }

// Repository
export interface OrderRepository {
  save(order: Order): Promise<void>;
  findById(id: OrderId): Promise<Order | null>;
}

// Adapter
export class TypeOrmOrderRepository implements OrderRepository { }

// Event
export class OrderPlacedEvent extends DomainEvent {
  constructor(public readonly orderId: OrderId) { super(); }
}
```

### Constants

- Use **UPPER_SNAKE_CASE** for constants:
  ```typescript
  export const MAX_ORDER_ITEMS = 50;
  export const ORDER_SAGA_TIMEOUT_MS = 30000;
  export const KAFKA_TOPIC_ORDER_EVENTS = 'order.events';
  ```

### Environment Variables

- Use **UPPER_SNAKE_CASE**:
  ```bash
  DB_HOST=localhost
  KAFKA_BROKERS=localhost:9092
  JWT_AUDIENCE=food-delivery-api
  ```

### Kafka Topics & Event Types

- **Topic names:** `{service}.{entity|events|replies}` (snake_case)
  ```
  order.events
  inventory.replies
  catalog.events
  payment.replies
  config.events
  ```

- **Event type names:** `{entity}_{action}` (snake_case)
  ```
  order_placed
  order_confirmed
  order_cancelled
  restaurant_created
  menu_item_added
  ```

## Error Handling

### Exception Hierarchy

```typescript
// Base exception (all app errors inherit)
export abstract class AppException extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

// Domain validation error
export class ValidationException extends AppException {
  constructor(message: string, public readonly errors: Record<string, string>) {
    super('VALIDATION_ERROR', 400, message);
  }
}

// Not found
export class NotFoundError extends AppException {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', 404, `${entity} with ID ${id} not found`);
  }
}

// Conflict (e.g., duplicate key)
export class ConflictError extends AppException {
  constructor(message: string) {
    super('CONFLICT', 409, message);
  }
}

// Internal error (unhandled)
export class InternalError extends AppException {
  constructor(message: string, public readonly cause?: Error) {
    super('INTERNAL_ERROR', 500, message);
  }
}
```

### Global Exception Filter

All exceptions are caught by `GlobalExceptionFilter` and transformed to a standardized response:

```typescript
// Response envelope
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "email": "Invalid email format",
    "name": "Name is required"
  },
  "timestamp": "2025-08-04T12:00:00Z",
  "path": "/api/v1/restaurants"
}
```

**Rule:** Never throw raw Error; always throw AppException subclass.

## Testing Standards

### Unit Tests (Jest)

- Test **one thing per test** — Single assertion or closely related assertions
- Use **descriptive test names:** `it('should return empty array when no restaurants found', ...)`
- Mock external dependencies (database, Kafka, gRPC, Redis)
- Place factories in `libs/shared/testing/factories/`

```typescript
describe('OrderService', () => {
  let service: OrderService;
  let mockOrderRepo: jest.Mocked<OrderRepository>;

  beforeEach(() => {
    mockOrderRepo = {
      save: jest.fn(),
      findById: jest.fn(),
    };
    service = new OrderService(mockOrderRepo);
  });

  it('should place order and save to repository', async () => {
    // Arrange
    const command = new PlaceOrderCommand('customer-1', 'restaurant-1', [...]);

    // Act
    const orderId = await service.placeOrder(command);

    // Assert
    expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.any(Order));
    expect(orderId).toBeDefined();
  });
});
```

### Integration Tests (Testcontainers + Jest)

- Spin up real containers (Postgres, Kafka, Redis, gRPC stubs)
- Test full request → domain → database → event flow
- Cleanup via Testcontainers lifecycle

```typescript
describe('Order E2E', () => {
  const postgresContainer = new PostgresContainer();
  const kafkaContainer = new KafkaContainer();

  beforeAll(async () => {
    await postgresContainer.start();
    await kafkaContainer.start();
    // Initialize app with real containers
  });

  afterAll(async () => {
    await postgresContainer.stop();
    await kafkaContainer.stop();
  });

  it('should complete order saga end-to-end', async () => {
    // POST /api/v1/orders
    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ customerId: '...', restaurantId: '...', items: [...] });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('PENDING');

    // Verify saga events published to Kafka
    const events = await kafkaContainer.waitForMessages(1);
    expect(events[0].type).toBe('order_placed');
  });
});
```

### Coverage Targets

- **Unit:** ≥ 80% coverage
- **Integration:** ≥ 60% coverage
- **Overall:** ≥ 75% coverage (enforced in CI)

## Code Quality Gates

### Biome (Linter + Formatter)

Configuration: `biome.json`

```bash
pnpm run lint          # Check formatting & linting
pnpm run lint:fix      # Auto-fix
```

**Rules:**
- 2-space indentation (no tabs)
- Single quotes (no double quotes)
- Trailing commas in multi-line objects/arrays
- No unused imports
- No console.log in production code (error on warn)
- No var (const/let only)

### Nx Dependency Cruiser

Enforces architectural boundaries; configuration: `.dependency-cruiser.js`

**Rules:**
- `domain/` cannot import from `infrastructure/`, `application/`, or `interface/`
- `application/` cannot import from `infrastructure/` (loosely enforced)
- `interface/` can import from any layer but should minimize domain imports
- Cross-service imports only via exported public API (barrel exports)

```bash
pnpm run cruiser       # Check boundaries
```

### Knip (Unused Code Detector)

Finds unused files, exports, imports:

```bash
pnpm run knip          # Report unused code
```

### TypeScript Strict Mode

`tsconfig.base.json` enforces strict checking:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

## Conventional Commits

Commit messages follow the Conventional Commits spec:

```
<scope>: <subject>

<body>

<footer>
```

**Format:**
- **scope** (mandatory): One of the 13 services or `shared-{lib-name}` or `infra` or `ci`
  - Example scopes: `order`, `catalog`, `payment`, `shared-messaging`, `infra`, `ci`
  - Enforced by commitlint (`.commitlintrc.json`)
- **subject** (mandatory): Imperative, lowercase, no period (max 50 chars)
  - Examples: "add order saga orchestrator", "fix inventory reserve race condition"
- **body** (optional): Detailed explanation (wrapped at 72 chars)
- **footer** (optional): Issue references, breaking changes
  - Example: `BREAKING CHANGE: Order.status field renamed to Order.orderStatus`

**Examples:**

```bash
# Simple feature
git commit -m "order: implement saga orchestrator for distributed transactions"

# Bugfix with body
git commit -m "catalog: fix outbox event duplication on transaction retry

Outbox adapter was not idempotent; added transaction ID deduplication.
Fixes #123"

# Infrastructure change
git commit -m "infra: add prometheus scrape config for custom metrics"

# Shared library
git commit -m "shared-messaging: add kafka consumer exactly-once semantics"

# Breaking change
git commit -m "order: rename Order.status to Order.orderStatus

BREAKING CHANGE: API clients must update to use orderStatus field."
```

**Scope Enum** (enforced):
```
gateway, auth, catalog, search, order, inventory, payment, delivery, media,
notification, review, analytics, config, shared-config, shared-settings,
shared-messaging, shared-persistence, shared-observability, shared-jwt,
shared-tenancy, shared-locking, shared-cache, shared-errors, shared-health,
shared-logging, shared-contracts, infra, ci
```

**Commit Types** (prefix before scope; loosely enforced):
- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation only
- `test:` — Test addition/modification
- `refactor:` — Code refactoring
- `perf:` — Performance improvement
- `chore:` — Dependency bump, config change (no feature/fix)

**Do NOT include:**
- Plan/phase references (e.g., "phase-02-order-saga") — Justification goes in PR description
- Finding codes (e.g., "F13", "Y1") — Irrelevant after plan completion
- AI references (e.g., "generated by Claude") — Irrelevant to code history

## Database Migrations

### TypeORM Migrations

Generate migrations after schema changes:

```bash
nx run {service}:migration-generate --name=add_restaurant_rating
```

Runs TypeORM introspection; creates file in `src/infrastructure/persistence/migrations/`.

**Migration Naming:**
- `{timestamp}-{description}.ts`
- Example: `1753660800000-create-catalog-outbox.ts`

**Pattern:** Each service manages its own migrations independently.

```typescript
// Example migration
export class CreateCatalogOutbox1753660800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'outbox',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'aggregate_id', type: 'uuid' },
          { name: 'event_type', type: 'varchar' },
          { name: 'payload', type: 'jsonb' },
          { name: 'created_at', type: 'timestamptz' },
        ],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('outbox');
  }
}
```

### Partitioning (Orders Table)

Orders table is monthly range-partitioned for performance:

```sql
CREATE TABLE orders_pYYYYMM PARTITION OF orders
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
```

Partitions are created via migration; partition management is manual (or via scheduled job).

## Performance Considerations

### Indexes

Key indexes for query performance:

```typescript
// In ORM entity
@Entity('orders')
export class OrderOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  customerId: string;

  @Column('uuid')
  @Index()
  restaurantId: string;

  @Column('varchar')
  @Index()
  status: string;

  @Column('timestamptz')
  @Index()
  createdAt: Date;
}
```

### Read Replica Strategy

List queries (high read volume) can route to replica:

```typescript
export class OrderRepository {
  async list(customerId: string): Promise<Order[]> {
    const dataSource = process.env.USE_READ_REPLICA
      ? this.replicaDataSource
      : this.primaryDataSource;

    return dataSource.query(`SELECT * FROM orders WHERE customer_id = $1`, [customerId]);
  }
}
```

## Documentation in Code

### No Plan/Phase References

Do NOT reference plan artifacts (phase numbers, finding codes) in code:

```typescript
// ❌ BAD
export class OrderSagaOrchestrator {
  // F13: advisory lock for saga orchestration
  async execute(command: PlaceOrderCommand): Promise<Order> {
    // ...
  }
}

// ✅ GOOD
export class OrderSagaOrchestrator {
  // Uses advisory lock to ensure single saga executor runs at a time
  async execute(command: PlaceOrderCommand): Promise<Order> {
    // ...
  }
}
```

### Business Logic Comments

Explain **why**, not **what** (code explains what):

```typescript
// ❌ BAD
// Increment saga attempt counter
sagaLog.attempts++;

// ✅ GOOD
// Increment attempt counter; saga reaper re-drives stalled sagas with exponential backoff.
// Max 3 attempts prevents infinite loops on permanent failures.
sagaLog.attempts++;
```

### Complex Algorithms

Add comments for non-obvious logic:

```typescript
// Nearest-driver assignment uses Redis GEO queries for O(log N) performance
// instead of Haversine distance calculation (O(N)), critical at high order volume.
const nearbyDrivers = await this.redis.georadius(
  `driver:locations:${tenantId}`,
  { latitude: delivery.lat, longitude: delivery.lng },
  { radius: 10, unit: 'km' },
);
```

## Development Workflow

### Local Development

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Start infrastructure:**
   ```bash
   docker compose --env-file .env -f infra/docker-compose.yml --profile core ... up -d
   ```

3. **Run migrations:**
   ```bash
   pnpm nx run-many -t migration-run
   ```

4. **Start all services:**
   ```bash
   pnpm dev
   ```

5. **Run tests:**
   ```bash
   pnpm test
   ```

6. **Lint & format:**
   ```bash
   pnpm run lint:fix
   ```

### Pre-commit Hooks (Lefthook)

Configured in `.lefthook.yaml`:

- **pre-commit:** Biome format check + lint
- **commit-msg:** Commitlint scope validation

Hooks are installed via `pnpm prepare`.

### Code Review Checklist

Before pushing to a PR:

- [ ] All tests pass (`pnpm test`)
- [ ] No lint errors (`pnpm run lint`)
- [ ] Dependency boundaries respected (`pnpm run cruiser`)
- [ ] No unused imports (`pnpm run knip`)
- [ ] TypeScript strict mode passes (`pnpm build`)
- [ ] Commit message follows conventional commits format
- [ ] Code follows hexagonal layering (no layer violations)
- [ ] Error handling uses AppException subclasses
- [ ] No plan/phase references in code
- [ ] Documentation (if new feature) added to `docs/`

## Summary

| Aspect | Standard |
|--------|----------|
| **Architecture** | Hexagonal + CQRS + Saga (order only) + Outbox/CDC |
| **Layering** | domain → application → infrastructure ← interface |
| **Naming** | kebab-case files, PascalCase classes, camelCase functions |
| **Commits** | Conventional; scope is service or lib name (required) |
| **Testing** | Jest unit ≥ 80%, Testcontainers e2e ≥ 60%, overall ≥ 75% |
| **Quality** | Biome, dependency-cruiser, knip, TypeScript strict |
| **Errors** | Use AppException subclasses; global filter standardizes responses |
| **Docs** | In code (no plan refs); explain why, not what |
| **Migrations** | TypeORM; one per service; manual partition mgmt for orders |

For detailed examples, see the corresponding service implementations in `apps/`.
