# Slice 3a — Kafka messaging substrate

Spec: [phase-03a-messaging-infra-and-shared-lib.md](../260725-2139-food-delivery-microservices/phase-03a-messaging-infra-and-shared-lib.md)
Branch: `feat/kafka-messaging-foundation` (not committed — user verifies + commits)

## What was built

**Deps** (`package.json`, exact-pinned per locked decision): `@confluentinc/kafka-javascript@1.10.0` (prod), `@testcontainers/kafka@12.0.4` (dev). `pnpm-workspace.yaml` — added `@confluentinc/kafka-javascript` to `onlyBuiltDependencies` (pnpm blocks native postinstall scripts by default; without this the native addon never installs).

**`libs/shared/messaging`** (tags `scope:shared, type:util`, mirrors `shared-locking` scaffold):
- `kafka-client.ts` — `KAFKA_CLIENT` token, `KafkaClient` type alias, `createKafkaClient()`. Kept separate from `messaging.module.ts` specifically to avoid a module↔producer circular import (module imports the producer class; producer needs the client token) — cruiser's `no-circular` rule would otherwise fail.
- `event-envelope.ts` — `EventEnvelope`/`EventEnvelopeHeaders`, `encodeHeaders`/`decodeHeaders` mapping `eventId/eventType/aggregateId/tenantId/correlationId/occurredAt` ↔ `x-event-id/x-event-type/x-aggregate-id/x-tenant-id/x-correlation-id/x-occurred-at`. Codec works in plain strings (not Buffer) — Buffer encoding is the producer/consumer's job at the wire boundary, not this layer's. Fails closed: `MissingEventHeaderError` on any absent required header.
- `kafka-producer.ts` — `KAFKA_PRODUCER` token, `MessageProducer` interface, `ConfluentMessageProducer` adapter. Idempotent producer via `kafkaJS: { idempotent: true, acks: -1 }` (the confluent client's kafkaJS-compat config equivalent of raw `enable.idempotence=true`/`acks=all`). `publish`/`publishBatch` JSON-serialize the value and Buffer-encode headers; `publishBatch` groups by topic for the vendor's `sendBatch({ topicMessages })` shape. Connects on `OnModuleInit`, flushes + disconnects on `OnModuleDestroy`.
- `kafka-consumer.ts` — `KafkaConsumerSubscriber.subscribe()`: `enable.auto.commit=false` (via `kafkaJS: { autoCommit: false }`), decodes headers, runs the handler inside `tenantContext.run({tenantId: envelope.tenantId, ...}, ...)` (tenant identity always sourced from the verified envelope header, never the payload), commits the offset after every message (success or exhausted-retry skip) so the group always advances. Retry/skip logic factored into an exported pure function `runHandlerWithRetry` (N attempts, exponential-ish backoff, then log+skip — full DLQ is P5) so it's unit-testable without a broker.
- `outbox-relay.ts` — `OUTBOX_PORT` port + `OutboxRelay` polling publisher (`fetchUnpublished`/`publishBatch`/`markPublished`), recursive-`setTimeout` loop with exponential backoff on failure, reset on success. Plain class, **not** registered by `MessagingModule` — a service constructs it with its own outbox table adapter and calls `.start()` itself.
- `idempotent-consumer.ts` — `PROCESSED_EVENT_STORE` port + `IdempotentConsumer.runOnce(store, eventId, tx, work)` (static). Port throws `DuplicateEventError` (our own type, not a raw DB code) on redelivery; `runOnce` catches it and skips `work`, keeping the port framework/DB-agnostic — the adapter (built in 3b/3c) translates its storage's actual unique-violation into this error.
- `kafka-admin.ts` — `KafkaTopicAdmin.ensureTopics(specs)`, idempotent `createTopics` (defaults 3 partitions / RF=1). No topic names hardcoded — naming is a 3b/3c concern.
- `messaging.module.ts` — `MessagingModule.forRoot({clientId, brokers})` registers only `KAFKA_CLIENT` + `KAFKA_PRODUCER`; `KafkaConsumerSubscriber`/`KafkaTopicAdmin` are plain exported `@Injectable()` classes a consuming service adds to its own providers (per spec: "registers the confluent client + idempotent producer as providers" only).
- `index.ts` barrel exporting the public surface.

**`infra/docker-compose.yml`** — `kafka` service under new `messaging` profile, verbatim per the spec's compose block (KRaft single-broker, `-Xmx512m`, healthcheck), `KAFKA_PORT` env-overridable host port.

**`.env.example`** — `KAFKA_PORT`, `KAFKA_BROKERS=localhost:9092`, `KAFKA_CLIENT_ID` guidance comment.

**Aliases**: `@food-delivery-api/shared-messaging` added to `tsconfig.base.json` paths + `knip.json` paths. `commitlint.config.mjs` already had `shared-messaging` in scope-enum (pre-existing).

**E2E** — `apps/messaging-e2e` (new e2e app, mirrors `apps/*-e2e` project/tsconfig/jest scaffold; `scope:shared, type:e2e`; `implicitDependencies: ["shared-messaging"]`). `kafka-round-trip.e2e-spec.ts`: boots `apache/kafka:4.3.1` via `@testcontainers/kafka`'s `KafkaContainer`, bootstraps a topic via `KafkaTopicAdmin`, produces two same-key messages with an envelope, consumes via `KafkaConsumerSubscriber` with manual commit, asserts intact headers/value and same-partition/produce-order for the shared key. **Not run** per instructions — main agent runs `pnpm nx e2e messaging-e2e`.

## Confluent client API decisions

`@confluentinc/kafka-javascript` exposes both a raw node-rdkafka-style API and a `KafkaJS` namespace — a promise-based, kafkajs-API-compatible facade over the same librdkafka native binding. Used `KafkaJS.Kafka`/`.producer()`/`.consumer()`/`.admin()` throughout (not the raw API) for a familiar, well-typed DX (`send`/`sendBatch`, `run({eachMessage})`, `commitOffsets`, `createTopics`) while still getting librdkafka's idempotent-producer/manual-commit guarantees. Config uses the `kafkaJS: {...}` sub-object (typed `ProducerConfig`/`ConsumerConfig`) rather than raw dashed librdkafka keys (`'enable.idempotence'`, `'group.id'`, etc.) — same underlying config, cleaner TS surface; documented the raw-key equivalence in comments since the spec/plan phrase things in raw-key terms.

## Version / native-build surprises

- **pnpm blocks the native postinstall by default.** `@confluentinc/kafka-javascript`'s install script (`node-pre-gyp install --fallback-to-build`) was silently skipped until `@confluentinc/kafka-javascript` was added to `pnpm-workspace.yaml`'s `onlyBuiltDependencies`. Without this the package installs but the native binding is absent and any `require()` throws at runtime. Not called out in the spec — flagging since it'll bite anyone re-cloning without noticing the pnpm warning.
- **No compile needed**: prebuilt binary fetched cleanly (`confluent-kafka-javascript-v1.10.0-node-v137-darwin-unknown-arm64.tar.gz`) — glibc concern from the risk table doesn't apply on this Darwin arm64 host; Linux/glibc bookworm-slim path in CI/Docker is unverified by this slice (no Docker build was run).
- Both `@confluentinc/kafka-javascript@1.10.0` and `@testcontainers/kafka@12.0.4` resolved exactly as pinned — no yanked-version fallback needed.

## Verification run (all green)

- `pnpm biome check libs/shared/messaging apps/messaging-e2e` — clean (after one `--write` pass for import ordering/formatting).
- `npx depcruise apps libs --config .dependency-cruiser.js` — 0 violations (344 modules/1140 deps cruised), confirms no app import from the shared lib and no cycle.
- `pnpm knip --no-config-hints` — clean (removed one redundant type re-export it flagged).
- `npx tsc --build` on both `libs/shared/messaging/tsconfig.json` and `apps/messaging-e2e/tsconfig.json` — 0 errors.
- `pnpm nx test shared-messaging` — 20/20 unit tests green (header codec round-trip/Buffer-decode/missing-header; `IdempotentConsumer.runOnce` first-delivery/duplicate-skip/store-error-propagation/work-error-propagation; `OutboxRelay.runOnce` + start/stop/backoff loop with fake timers; `runHandlerWithRetry` success/retry-then-succeed/exhausted-retries-skip using the **real** `AlsTenantContextAdapter`, not a fake, to prove tenant-scope propagation genuinely works through the async chain).
- `pnpm test` (full repo, 18 projects) — all green, no regressions.
- E2E **not executed** (per instructions) — code compiles and lints clean; correctness of the live round-trip is unverified by me.

## Unresolved questions

1. `@testcontainers/kafka`'s `KafkaContainer` env-var bootstrap (`KAFKA_LISTENERS`, `/etc/confluent/docker/run` entrypoint) originates from Confluent's `cp-kafka` image convention. Whether `apache/kafka:4.3.1` (the plan's locked e2e image) accepts this same entrypoint/env scheme is **unverified** — I could not run the e2e per instructions. If it fails to boot, the module's bootstrap script (`docker exec`ing `/etc/confluent/docker/run`) is the first suspect; the compose `kafka` service uses the native `apache/kafka` image env scheme directly (verified against the spec doc) and is a separate, likely-safer path.
2. Host↔container advertised-listener wiring for the **compose** `kafka` service (single `PLAINTEXT://kafka:9092` advertised listener, per spec) is unverified — the plan's own risk table already flags this as the first thing to check on `docker compose --profile core --profile messaging up`.
3. `KAFKA_EXTERNAL_PORT = 9093` in the e2e spec is read from the testcontainers module's source (`KafkaContainer`'s private `KAFKA_PORT` constant is not exported); if a future `@testcontainers/kafka` version changes this, the e2e will need updating.

**Status:** DONE_WITH_CONCERNS
**Summary:** Full `libs/shared/messaging` lib + compose service + e2e built exactly per spec; all lint/cruiser/knip/tsc/unit-test gates green (20/20 tests, 18/18 projects). Concern is scoped entirely to the e2e's untested live behavior (I was told not to run it) — everything I could verify statically is clean.
