# Slice 3a — Messaging infra + `libs/shared/messaging`

Context: [phase-03.md](./phase-03-event-driven-backbone.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md) · [development-workflow.md](./development-workflow.md)
Report: [researcher-260728-phase-03-event-driven-stack.md](./reports/researcher-260728-phase-03-event-driven-stack.md)

## Overview
- **Priority**: P0 — foundation for 3b/3c/3d.
- **Status**: ✅ Verified — Kafka round-trip e2e green; compose broker boots healthy (RAM ~283 MiB) + host-reachable; static (biome/cruiser/knip/tsc) + unit 20/20 green. Two fixes over the agent build: (1) the e2e broker uses `confluentinc/cp-kafka:7.9.1` — `@testcontainers/kafka` only auto-wires advertised listeners for the cp-kafka family, not the raw `apache/kafka` image (compose still runs `apache/kafka:4.3.1`); (2) compose Kafka switched to a **dual listener** (`HOST://localhost:9092` for host processes + `INTERNAL://kafka:9094` for in-network Debezium/Connect in 3b). Code-review round 1 (1 Critical, 1 High, 2 Med, 4 Low) + fix + round-2 verification all done — every finding CLOSED, no regressions. **Carry-forward to 3d**: the consumer has TWO silent skip paths that only `logger.error` today — undecodable message (decode guard) and handler-exhausted retry — 3d's DLQ must cover BOTH plus a drop counter so a stalled saga is observable. Ready to merge.
- **Branch (example)**: `feat/shared-messaging-kafka`
- **Brief**: Stand up the `messaging` docker-compose profile (single-broker Kafka 4.3.1 KRaft) and build the shared Kafka wrapper lib (`libs/shared/messaging`): producer, consumer, event-header codec, polling outbox relay, idempotent-consumer helper. Prove it with a Kafka round-trip e2e using the testcontainers Kafka module. No service touches Kafka yet — this is the reusable substrate.

## Key insights / decisions
- **Client = `@confluentinc/kafka-javascript@1.10.0`** wrapped in our own Nest module. Rationale: `kafkajs@2.2.4` is unmaintained (3 yrs, last 2023); `@nestjs/microservices` Kafka transport is coupled to kafkajs AND its request/reply model fights our outbox + manual-commit + saga design. We need a hand-rolled wrapper regardless, so pick the actively-maintained, Confluent-backed librdkafka client. Native addon is fine on our **glibc** `node:24-bookworm-slim` images (repo already mandates glibc over musl for native modules — bcrypt/grpc/sharp). Prebuilt arm64 binaries exist → no compile on M4 host for e2e. (Fallback if native build bites: `@nestjs/microservices`+kafkajs — documented, not chosen.)
- Single broker, `RF=1`, heap-capped `-Xmx512m`. Topics use **3 partitions** keyed by aggregate id to actually exercise partition-key ordering (the learning goal), not 1.
- The lib is `scope:shared, type:util`; it may import `shared-tenancy` (shared→shared allowed) so the consumer can re-establish tenant context from headers. It must NEVER import app code (cruiser-enforced).

## Requirements
**Functional**: produce a keyed message with headers to a topic; consume it in a group with manual offset commit; encode/decode the event envelope ↔ Kafka headers; a polling relay that drains an outbox table and marks rows published; an idempotent-consumer helper that dedupes by event id inside the effect's tx.
**Non-functional**: idempotent producer (`enable.idempotence=true`); manual commit (no auto-commit); consumer runs each message inside `TenantContextPort.run(...)`; broker heap-capped; profile fits 16 GB alongside `core`(+`auth`).

## Architecture / data flow
```
producer.publish({topic,key,headers,value})
        │ idempotent producer (acks=all, enable.idempotence)
        ▼
   Kafka topic (3 partitions, key=aggregateId → same partition → ordered)
        ▼
consumer group  ──▶ decodeHeaders → TenantContextPort.run(ctx, () =>
                       IdempotentConsumer.runOnce(consumer, eventId, tx, work))
                     ──▶ manual commit offset
```
Outbox relay (used by 3c services): `setInterval` loop → `OUTBOX_PORT.fetchUnpublished(limit)` (`FOR UPDATE SKIP LOCKED`) → `producer.publishBatch` → `OUTBOX_PORT.markPublished(ids)`. Relay loop + backoff live in the lib; the table adapter lives in each service's infra.

## Related code files (to create)
- `libs/shared/messaging/project.json` · `tsconfig*.json` · `jest.config.cts` · `src/index.ts`
- `src/messaging.module.ts` — `MessagingModule.forRoot({ clientId, brokers })` (registers the confluent client + idempotent producer as providers).
- `src/kafka-producer.ts` — `KAFKA_PRODUCER` token + `MessageProducer` interface + confluent adapter (`publish`, `publishBatch`).
- `src/kafka-consumer.ts` — subscribe helper: manual-commit loop, decodes headers, opens tenant context, invokes handler.
- `src/event-envelope.ts` — `EventEnvelope` type + `encodeHeaders`/`decodeHeaders`.
- `src/outbox-relay.ts` — `OUTBOX_PORT` interface + `OutboxRelay` polling publisher.
- `src/idempotent-consumer.ts` — `PROCESSED_EVENT_STORE` port + `IdempotentConsumer.runOnce`.
- `src/kafka-admin.ts` — topic bootstrap helper (create the 6 topics `partitions=3, RF=1` if absent).
- `infra/docker-compose.yml` — add `kafka` service (profile `messaging`); add `kafka-topics-init` one-shot (optional) OR rely on `kafka-admin` bootstrap on service start.
- `infra/kafka/` — optional broker config notes / cluster-id generation snippet.
- `.env.example` — `KAFKA_BROKERS=localhost:9092`, `KAFKA_CLIENT_ID` per service.
- `libs/shared/messaging-e2e/` (or a `*.e2e.spec.ts` under the lib) — testcontainers Kafka round-trip.

## Compose service (verified live 2026-07-28)
```yaml
kafka:
  image: apache/kafka:4.3.1        # arm64-native; latest stable (2026-06-25)
  container_name: food-delivery-kafka
  profiles: [messaging]
  ports: ["9092:9092"]
  environment:
    KAFKA_NODE_ID: 1
    KAFKA_PROCESS_ROLES: "broker,controller"
    KAFKA_CONTROLLER_QUORUM_VOTERS: "1@kafka:9093"
    KAFKA_LISTENERS: "PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093"
    # dual advertised so host tests + in-network services both connect:
    KAFKA_ADVERTISED_LISTENERS: "PLAINTEXT://kafka:9092"   # in-network name; host uses 9092 mapping
    KAFKA_INTER_BROKER_LISTENER_NAME: "PLAINTEXT"
    KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER"
    KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
    KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
    KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0
    KAFKA_HEAP_OPTS: "-Xmx512m -Xms512m"
    CLUSTER_ID: "MkU3OEVBNTcwNTJENDM2Qg"   # or generate: kafka-storage.sh random-uuid
  healthcheck:
    test: ["CMD-SHELL", "/opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 20s
```
Idle RAM ~0.3–1.0 GB. Verify host↔container advertised-listener wiring on first boot; if host tests can't reach broker, add a second `HOST://` listener advertised as `localhost:9092` (dual-listener pattern) — note it as the tuning knob.

## Implementation steps
1. `pnpm add @confluentinc/kafka-javascript@1.10.0` (prod dep); `pnpm add -D @testcontainers/kafka@12.0.4`.
2. Scaffold `libs/shared/messaging` (mirror `libs/shared/locking` project.json/tsconfig/jest). Tags `scope:shared, type:util`.
3. `MessagingModule.forRoot({ clientId, brokers })` — build a singleton confluent producer (`enable.idempotence:true, acks:all`) provided under `KAFKA_PRODUCER`.
4. `MessageProducer` adapter — `publish({topic,key,headers,value})`, `publishBatch`. Serialize value to JSON `Buffer`; headers as `Record<string,string>` buffers.
5. `EventEnvelope` + `encodeHeaders`/`decodeHeaders` — map `{eventId,eventType,aggregateId,tenantId,correlationId,occurredAt}` ↔ Kafka headers (`x-event-id`, `x-event-type`, `x-tenant-id`, `x-correlation-id`, …).
6. Consumer subscribe helper — confluent consumer with `enable.auto.commit=false`; per message: decode headers → `tenantContext.run(ctx, () => handler(msg))` → commit offset. Surface a simple retry (N attempts, then log+skip; full DLQ P5).
7. `OUTBOX_PORT` + `OutboxRelay` — interval loop calling `fetchUnpublished`/`markPublished`; injectable, started by consuming services (not auto-started in the lib).
8. `PROCESSED_EVENT_STORE` + `IdempotentConsumer.runOnce(consumer,eventId,tx,work)` — insert dedupe row; on unique-violation, treat as already-processed and skip `work`.
9. `kafka-admin` bootstrap — create the 6 topics (`partitions=3, RF=1`) idempotently.
10. Add the `kafka` compose service + `.env.example` keys.
11. **E2E** (`@testcontainers/kafka`, explicit image `apache/kafka:4.3.1`): boot broker → produce a keyed message with headers → consume in a group with manual commit → assert value + decoded headers + ordering for same key. Second case: two messages same key land on same partition in order.
12. Update phase-03/03a todos + status BEFORE push (DoD).

## Todo
- [x] Deps added (`@confluentinc/kafka-javascript@1.10.0`, `@testcontainers/kafka@12.0.4`)
- [x] `libs/shared/messaging` scaffolded (project.json, tags, index)
- [x] `MessagingModule.forRoot` + idempotent producer
- [x] `MessageProducer` (publish/publishBatch)
- [x] `EventEnvelope` + header codec
- [x] consumer subscribe helper (manual commit + tenant-context run)
- [x] `OutboxRelay` + `OUTBOX_PORT`
- [x] `IdempotentConsumer` + `PROCESSED_EVENT_STORE`
- [x] topic bootstrap admin helper
- [x] `kafka` compose service (profile `messaging`) + `.env.example`
- [ ] Kafka round-trip e2e (testcontainers) green — written (`apps/messaging-e2e`), not yet executed
- [x] biome / cruiser / knip clean; plan updated before push

## Success criteria
- `docker compose --profile core --profile messaging up` → Kafka healthy; RAM measured and recorded in architecture.md (§6).
- Round-trip e2e: produced message consumed with intact headers + value; same-key ordering holds.
- Lib exports a clean surface; cruiser shows no app import; knip clean.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Confluent native addon build in Docker | M×M | glibc bookworm-slim + prebuilt arm64 binaries; add build-essential in builder stage only if compile triggers; fallback client documented |
| Host↔container advertised-listener mismatch | M×M | Dual-listener pattern (add `HOST://…:9092` advertised `localhost`) if host e2e can't connect |
| Broker RAM on 16 GB | L×M | `-Xmx512m`; only `core`+`messaging` up; measured in step 11 |
| testcontainers image drift | L×L | Pin explicit `apache/kafka:4.3.1` in the container ctor |

## Security considerations
- Kafka on internal network; host port 9092 exposed for dev/e2e only (not via Nginx).
- Envelope carries `tenantId` + `correlationId`; consumer opens tenant scope from the header, never trusts payload alone.
- No secrets in events; `.env.example` documents broker URL only.

## Next steps
Unblocks 3b (catalog outbox + Debezium + CQRS) and 3c (order saga). Both reuse this lib's producer/consumer/relay/dedupe.
</content>
