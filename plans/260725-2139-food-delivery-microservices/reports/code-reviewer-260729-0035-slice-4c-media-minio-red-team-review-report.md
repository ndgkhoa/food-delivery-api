# Slice 4c — Media/MinIO Red-Team Review

Branch `feat/media-minio-uploads` · `git diff develop...HEAD` (1 commit) + 1 uncommitted e2e import removal.
Scope: `apps/media/`, `apps/media-e2e/`, gateway media proxy, compose `minio`. Runtime proven green — this pass hunts correctness/security the happy path doesn't exercise.

## Verdict
Tenant isolation is **solid** across every path. The headline defect is that the **MIME/size upload policy is advisory only** — it is validated against client-declared values at URL-issue time and **never re-verified against the actual stored object**, which an authenticated tenant can weaponize into a shared-worker OOM.

---

## CRITICAL

### C1 — Declared content-type & size are never enforced on the stored object (advisory gate) → storage abuse + cross-tenant worker OOM
Files: `application/create-upload.handler.ts:51-67`, `application/complete-upload.handler.ts:35-38`, `infrastructure/minio/minio-object-storage.adapter.ts:24-26,32-42,44-51`, `application/generate-thumbnail.handler.ts:42`.

Trace:
1. `create-upload` runs `assertAllowedUpload(declared contentType, declared sizeBytes, ...)` then issues a **plain presigned PUT** via `client.presignedPutObject(bucket, key, ttl)` (adapter:24-26). A plain presigned PUT carries **no content-length-range and no content-type condition** — the client may PUT arbitrary bytes of any size to that key.
2. `complete-upload` calls `statObject` and only checks `if (!stat) throw ObjectNotUploadedError` (handler:35-38). It **never compares `stat.sizeBytes` to `media.sizeBytes`/`maxBytes`, and never checks content-type.** `statObject` doesn't even return content-type — it returns `{ sizeBytes }` only (adapter:32-42).

Concrete abuse (authenticated tenant): declare `image/png, 100` → get URL → `PUT` 5 GB of arbitrary bytes → `complete` → succeeds (object exists), row advances to UPLOADED. The `MAX_UPLOAD_BYTES=5_000_000` ceiling is meaningless against the stored object.

Impact:
- **Worker OOM (the real teeth).** The thumbnail worker's `getObject` (adapter:44-51) reads the **entire object into one `Buffer` via `Buffer.concat` with no size cap** — the 5 MB cap is not enforced at download. `generate-thumbnail.handler.ts:42` calls it before sharp ever sees the bytes. A single oversized object → worker process OOM. With `jobId=mediaId, attempts=3` it redelivers and OOMs again. The worker is a **single shared process across all tenants**, so one authenticated tenant denies thumbnail processing to everyone. This is the cross-tenant availability bug.
- **Storage/cost exhaustion** — unbounded object bytes per upload.
- **Stored-object content-type is whatever the client PUT**, later served verbatim by `presignGet` (adapter:28-30). Lower risk (served from the MinIO origin, not the API origin) but the "image" record can hold `text/html`/script bytes.

Partial mitigation that DOES hold: sharp rejects non-image bytes → job fails → row stays UPLOADED (never a false READY — verified correct). But that fires *after* the unbounded download, so it does not prevent the OOM, and the oversized object is already stored.

Fixes (any of, ideally 1+3):
1. In `complete-upload`, have `statObject` also return content-type; reject (delete object + `InvalidUploadError`/409) when `stat.sizeBytes > maxBytes` or `stat.sizeBytes` diverges from declared, or content-type not on allowlist.
2. Prefer `presignedPostPolicy` (content-length-range + content-type conditions) over `presignedPutObject` so MinIO rejects oversized/wrong-type at upload time.
3. Cap the worker download: `statObject` first, abort if `> maxBytes` before `getObject` (and/or stream with a hard byte limit). This alone neutralizes the OOM even if 1–2 slip.

Severity note: the spec comment on `create-upload.handler.ts:25-29` and `upload-validation.ts:3-8` assert the policy is "enforced FIRST … no disallowed request" — accurate for the *declared* request, misleading for the *stored object*. The gate is advisory.

---

## HIGH

### H1 — Bucket bootstrap TOCTOU on multi-replica boot
File: `infrastructure/minio/bucket-bootstrap.ts:29-33`.
`bucketExists` then `makeBucket` is check-then-act. Two media replicas booting concurrently on a fresh MinIO: both see `exists=false`, both `makeBucket` → the loser throws `BucketAlreadyOwnedByYou`/`BucketAlreadyExists`, which is uncaught in `onApplicationBootstrap` → that replica crashes on startup. Real in any >1-replica deploy.
Fix: wrap `makeBucket` in try/catch and swallow the already-exists/already-owned codes (idempotent create).

---

## MEDIUM

### M1 — `status` column has no bounded-set constraint
File: `persistence/migrations/1754006400000-create-media-objects.ts:22`.
`status varchar(20) NOT NULL` with no `CHECK (status IN ('PENDING','UPLOADED','READY'))`. The bounded set lives only in the domain enum; a bad writer/migration could persist any ≤20-char string. Add a CHECK constraint (cheap defense-in-depth).

### M2 — `get` on a PENDING row returns a presigned GET URL to a non-existent object
File: `application/get-media.handler.ts:44-45`.
`presignGet(media.objectKey)` is always issued regardless of status. On a PENDING row (bytes not yet uploaded) the returned `url` points at a key that doesn't exist → client GET 404s. Not a 500 (presign just signs a URL), so not a crash — but it's a broken bearer URL surfaced as if valid. Consider omitting `url` (or 409) until status ≥ UPLOADED.

---

## LOW

### L1 — `complete` re-enqueues on an already-READY row
File: `application/complete-upload.handler.ts:40-44`. A repeat `complete` on a READY row skips the save (no regression — good) but still `queue.enqueue(id)` unconditionally. With `removeOnComplete:true` the prior job is gone, so this adds a fresh job that the worker runs and short-circuits via `isReady` (generate-thumbnail:38-40). Correct but wasteful. Guard: skip enqueue when `media.isReady`.

### L2 — sharp uses default `limitInputPixels`
File: `infrastructure/image/sharp-image-processor.adapter.ts:12-14`. Default ~268 MP guard is on, but combined with the unbounded download (C1) a high-pixel small-file decompression bomb could inflate memory during resize. Fixing C1's download cap largely covers this; optionally set an explicit `limitInputPixels`.

---

## Verified correct (did not re-litigate "does it work")
- **Tenant isolation — every HTTP path.** `tenantId` always from `tenantContext.getTenantIdOrThrow()` (verified identity), never a client field. `create` builds `{tenantId}/{uuid}` (`media-keys.ts:7`). `complete` + `get` load via `findById(id, tenantId)` — `WHERE id AND tenant_id` (`typeorm-media-object.repository.ts:21-24`), so tenant-B gets `null`→404 on tenant-A's id. Media id is `randomUUID` (unguessable) **and** tenant-checked — both, not one. Presigned URLs are built from `media.objectKey` loaded off the row, never a client-supplied key.
- **Worker tenant scoping.** `findByIdForProcessing(id)` (repository:26-29) intentionally omits tenant (no request scope) and derives `thumbnailKey` from `media.tenantId` off the row (generate-thumbnail:44) — tenant-scoped via data, not context. Correct.
- **No false READY.** Row flips READY only after thumbnail is stored (generate-thumbnail:45-47); any throw → job fails/retries → stays UPLOADED. `removeOnFail:false` retains for inspection.
- **jobId dedup** `jobId=mediaId` prevents duplicate concurrent jobs; generate-thumbnail is idempotent (`isReady` early return) and thumbnail key is deterministic → retry overwrites same key.
- **complete on missing object** → `ObjectNotUploadedError` → 409, clean (filter:33-35). Not a 500 or stuck job.
- **get on UPLOADED** (thumbnail not ready) → original url + no `thumbnailUrl` (guarded by `isReady && thumbnailKey`, get:46). Not a 500.
- **TTL** `PRESIGN_TTL_SECONDS` default 300, explicitly passed to BOTH `presignPut` and `presignGet` (create:66, get:44,47) — not defaulted to MinIO's 7 days.
- **No secret/URL leakage.** Worker logs only `job.id` + `err.message` (worker:47-49). MinIO secret stays in config; no presigned URL or secret logged.
- **Connection lifecycle.** Queue + worker each own an IORedis conn, drained on `onApplicationShutdown` with `status !== 'end'` guard (queue:47-52, worker:52-57); `main.ts:23` `enableShutdownHooks()`.
- **Boundary + hexagonal.** Global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` (main:26-32); `CreateUploadRequest` validated (dto:8-17). Domain imports no minio/sharp/bullmq/typeorm; only `app.module` crosses layers. Controller uses `ParseUUIDPipe` on `:id`. Migration: identity cols NOT NULL, `tenant_id` index present, `down()` drops table. No "phase"/finding tokens in code/filenames. Files all <200 lines.
- **Env** MinIO creds `.min(1)` but dev-defaulted (`minioadmin`) — acceptable for dev; ensure prod overrides (not fail-closed, but documented as dev default).
- **Uncommitted tweak** — harmless unused `randomUUID` import removal in the e2e spec.

---

## Unresolved questions
1. Is the media worker deployed as a single shared process/replica (amplifies C1 OOM to full thumbnail-service outage), or per-tenant/scaled? Confirms C1 blast radius.
2. Product intent on stored content-type: should `complete` hard-reject when the actual object's content-type differs from the declared allowlisted value, or is sharp-validates-on-thumbnail deemed sufficient? (Drives whether C1 fix #1 is required or #3 alone suffices.)
3. Prod deployment: are MinIO creds guaranteed overridden from the `minioadmin` dev default? If not, add a prod fail-closed check.

**Status:** DONE_WITH_CONCERNS
Tenant isolation and the async state machine are correct; one Critical stands: the MIME/size gate is advisory — declared values are never verified against the stored object, letting an authenticated tenant PUT an oversized blob that OOMs the shared thumbnail worker (C1). Cap the worker download (and ideally re-check size/type on complete) before merge.
