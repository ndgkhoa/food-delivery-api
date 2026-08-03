# Slice 4c — Media service (MinIO presigned uploads + BullMQ thumbnails)

Context: [phase-04.md](./phase-04-search-realtime-media.md) · [architecture.md](./architecture.md) · [hexagonal-service-architecture.md](./hexagonal-service-architecture.md)

## Overview
- **Priority**: P1 — third and last P4 track (independent of 4a search + 4b delivery).
- **Status**: ✅ Verified — media-e2e 3/3 GREEN on live compose (`core` + `media` MinIO): create-upload (validate mime/size) → PUT bytes to the presigned URL → complete (statObject) → BullMQ/sharp thumbnail → `GET` returns working presigned original + thumbnail URLs; disallowed-MIME/over-size rejected before a URL is issued; tenant isolation. Confirmed in Postgres: a READY row with tenant-prefixed `object_key`+`thumbnail_key`. Unit 21, tsc/biome/dependency-cruiser(576)/knip clean (build agent stalled before gates; orchestrator ran them + the live e2e). **Adversarial review: tenant isolation + async state machine verified airtight; no false READY.** Fixes applied (re-verified e2e 3/3 green): **C1 (Critical)** — the MIME/size gate was advisory (a presigned PUT lets the client write arbitrary bytes; complete only checked existence; the worker `getObject` read the whole object into a Buffer uncapped → an oversized blob OOMs the shared worker). Fixed: `complete` re-checks the **MinIO-reported actual size** (not the client-declared value) and deletes + rejects anything over the ceiling before enqueue; the worker `getObject` is capped at `MAX_UPLOAD_BYTES` (defense in depth). Content-type is NOT re-checked on complete (it's client-controlled on the PUT and would reject legit uploads MinIO stores as `application/octet-stream`) — sharp validates the real image bytes and a non-image simply fails the job (row stays UPLOADED, never false READY). **H1** bucket-bootstrap swallows already-exists (multi-replica TOCTOU); **M1** `status` gets a `CHECK IN (...)`; **M2** `GET` on a PENDING row no longer returns a presigned URL to a non-existent object; **L1** `complete` on a READY row is a no-op. Review report: `reports/code-reviewer-260729-0035-slice-4c-media-minio-red-team-review-report.md`. **Completes P4.**
- **Brief**: New `apps/media` service: issues **presigned PUT** URLs so clients upload images DIRECTLY to MinIO (the app never proxies bytes), records object metadata in Postgres, and on upload-completion enqueues a **BullMQ** job whose worker generates a thumbnail with **sharp** back into MinIO; `GET` returns short-TTL presigned URLs for the original + thumbnail. Self-contained: MinIO + BullMQ (the existing `core` Redis) + Postgres — no Kafka (no consumer needs a media event yet; BullMQ is the internal work queue).

## Key decisions (versions verified live 2026-07-29)
- **MinIO** `minio/minio:RELEASE.2025-09-07T16-13-09Z` single-node (`core` profile, or its own `media` profile), client `minio@8.0.7`. Console + S3 API; dev creds via env.
- **Thumbnails** `sharp@0.35.3` in a **BullMQ `5.81.2`** worker on the existing `core` Redis (`ioredis` already a dep). The completion call enqueues a job; the worker downloads the original from MinIO, resizes, uploads the thumbnail, updates metadata → `READY`.
- **No byte-proxying**: client PUTs to a presigned URL and GETs via presigned URLs. The app only issues URLs + stores metadata + runs the thumbnail worker.
- **No Kafka**: nothing consumes a `media.uploaded` event yet (YAGNI). If P6 needs it, add a Kafka emit alongside the BullMQ enqueue — documented, not built.
- **Tenant isolation**: object keys are `{tenantId}/{uuid}` (per-tenant prefix); presigned URLs are short-TTL; metadata rows tenant-scoped; a client can only complete/get its own tenant's objects.

## Requirements
**Functional**: `POST /media/uploads` (validate MIME allowlist + max size) → create metadata row `PENDING` + return `{ objectKey, uploadUrl (presigned PUT, short TTL) }`; `POST /media/uploads/:id/complete` → verify the object exists in MinIO + mark `UPLOADED` + enqueue a thumbnail job; the worker → generate + store thumbnail → mark `READY (thumbnailKey)`; `GET /media/:id` → `{ status, url (presigned GET original), thumbnailUrl? }`.
**Non-functional**: presigned URLs short-lived (e.g. 300s); MIME + size bounded BEFORE issuing the PUT; thumbnail generation idempotent (re-run yields the same thumbnail key, job dedup by object id); bucket auto-created on boot; tenant-prefixed keys; worker failures retried by BullMQ then left visible (status stays `UPLOADED`, not silently `READY`).

## Architecture / data flow
```
client ─POST /media/uploads(mime,size)─▶ media: validate → metadata row PENDING(objectKey={tenant}/{uuid})
        ◀─ { objectKey, uploadUrl=presignedPUT }
client ─PUT bytes──────────────────────▶ MinIO (direct, presigned)
client ─POST /uploads/:id/complete─────▶ media: statObject(MinIO) → row UPLOADED → BullMQ.add(thumbnail, {id})
                                              │
                          BullMQ worker ──▶ getObject(original) → sharp resize → putObject(thumb {tenant}/{uuid}_thumb)
                                              └─▶ row READY(thumbnailKey)
client ─GET /media/:id─────────────────▶ media: presigned GET original (+ thumbnail if READY)
```

## Related code files (to create)
- `apps/media/` — Nx HTTP app: project.json (`scope:media, type:app`), tsconfig*, jest, webpack, main.ts (:3006, prefix `api/v1`, pino, shutdown hooks).
- `config/media-env-schema.ts` — PORT 3006, MINIO_ENDPOINT/PORT/ACCESS_KEY/SECRET_KEY/USE_SSL, MEDIA_BUCKET, REDIS_URL (BullMQ), PRESIGN_TTL_SECONDS (300), MAX_UPLOAD_BYTES, ALLOWED_MIME (csv), THUMBNAIL_WIDTH (200).
- `domain/media/*` — `MediaObject` model + status enum (PENDING/UPLOADED/READY), `media-object.repository.ts` port, `object-storage.port.ts` (presignPut/presignGet/stat/get/put), `thumbnail-queue.port.ts` (enqueue), validation (mime allowlist, size).
- `infrastructure/minio/*` — MinIO client module (minio@8), `MinioObjectStorage` adapter + bucket bootstrap (make-bucket if absent on boot).
- `infrastructure/persistence/*` — TypeORM entity + repo + migration `*-create-media-objects.ts` (`media_objects`: id, tenant_id, object_key, content_type, size_bytes, status, thumbnail_key, created_at, updated_at; index tenant_id).
- `infrastructure/queue/*` — BullMQ queue (enqueue) + `thumbnail.worker.ts` (sharp) + worker bootstrap provider.
- `interface/http/media.controller.ts` + DTOs — create-upload, complete, get. Tenant-scoped (`shared-tenancy` TrustedIdentityInterceptor, like catalog reads/writes).
- `application/*` — create-upload, complete-upload, get-media, generate-thumbnail handlers.
- `infra/docker-compose.yml` — `minio` service (`media` or `core` profile) + `infra/postgres/init/01-create-service-databases.sh` (+`media` DB). `.env.example` — media keys. `package.json` — `media` in `dev` + `db:migrate` (media). `apps/gateway/*` — proxy `/api/v1/media/*`.
- `apps/media-e2e/` — real MinIO + Postgres + Redis (compose or testcontainers): create-upload → PUT to presigned URL → complete → poll until READY → GET returns original + thumbnail presigned URLs that actually fetch; MIME/size rejection; tenant isolation.

## Implementation steps
1. Scaffold `apps/media` (HTTP app + its Postgres) mirroring catalog's shape.
2. Migration `media_objects`; TypeORM entity/repo.
3. MinIO client module + `MinioObjectStorage` (presignPut/presignGet/stat/getObject/putObject) + bucket bootstrap on boot.
4. create-upload: validate mime/size → row PENDING → presigned PUT → return objectKey+uploadUrl.
5. complete-upload: statObject → row UPLOADED → enqueue BullMQ thumbnail job (jobId = media id for dedup).
6. BullMQ worker: getObject → sharp resize (width THUMBNAIL_WIDTH) → putObject thumb → row READY(thumbnailKey). Retry on failure (BullMQ attempts); leave UPLOADED if exhausted.
7. get-media: presigned GET original + thumbnail (if READY), tenant-scoped.
8. compose MinIO + media DB init + gateway proxy + `.env.example` + `dev`/`db:migrate`.
9. **E2E**: full upload→complete→thumbnail→get roundtrip against real MinIO; rejection cases; tenant isolation.
10. Update plan todos/status BEFORE push.

## Todo
- [ ] `apps/media` scaffolded (HTTP + Postgres) + MinIO client module + bucket bootstrap
- [ ] `media_objects` migration + repo
- [ ] create-upload (validate mime/size → PENDING → presigned PUT)
- [ ] complete-upload (statObject → UPLOADED → enqueue BullMQ job, deduped by id)
- [ ] BullMQ thumbnail worker (sharp → putObject → READY), retried
- [ ] get-media (presigned GET original + thumbnail), tenant-scoped
- [ ] compose MinIO + media DB init + gateway proxy + dev/db:migrate + .env.example
- [ ] E2E: upload→complete→thumbnail→get roundtrip + mime/size reject + tenant isolation
- [ ] biome/cruiser/knip clean; unit tests; plan updated before push

## Success criteria
- Client uploads an image DIRECTLY to MinIO via a presigned PUT; a thumbnail is generated; `GET` returns working presigned URLs for original + thumbnail. App never proxies bytes.
- Over-size / disallowed-MIME upload is rejected BEFORE a PUT URL is issued.
- Tenant isolation: keys tenant-prefixed; one tenant cannot complete/get another's object; presigned URLs short-TTL.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Client claims complete without uploading | M×M | `statObject` in complete verifies the object exists before UPLOADED + enqueue |
| Thumbnail worker crash → stuck | M×M | BullMQ retries (attempts+backoff); status stays UPLOADED (visible), not false READY; re-complete re-enqueues (jobId dedup) |
| sharp native build on the image | L×M | glibc `node:24-bookworm-slim` (repo mandates glibc for native modules); prebuilt binaries |
| Presigned URL leakage | M×M | Short TTL, tenant-prefixed keys, per-object uuid, validate before issue |
| MinIO RAM on 16GB | L×L | Single node, small; only needed profiles up |
| Unbounded object growth | L×M | Out of scope; lifecycle/expiry note (P8) |

## Security considerations
- Validate MIME (allowlist) + size BEFORE issuing the presigned PUT; the PUT URL is scoped to one object key + short TTL.
- Object keys tenant-prefixed from the verified identity; complete/get authorize the row's tenant against the caller. No cross-tenant object access.
- MinIO on internal network; console/API dev-exposed only, never via Nginx. Dev creds in `.env`; real creds via secret provider (P8).

## Next steps
Media URLs consumed by catalog/menu images (restaurant/menu photos) + P6 review images. Kafka `media.uploaded` emit added if/when a consumer needs it. Completes P4 — all three tracks (search, delivery, media) done.
