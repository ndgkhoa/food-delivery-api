import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { makePng } from './png-fixture';

/**
 * End-to-end proof of the media upload pipeline against REAL infrastructure.
 * Like the other cross-service e2e, this does NOT spin up testcontainers — it
 * drives a live compose stack (MinIO + Postgres + Redis) with the media service
 * running. Run it against:
 *
 *   docker compose -f infra/docker-compose.yml --profile core --profile media up -d
 *   DB_NAME=media pnpm migration:media:run
 *   pnpm --filter media serve          # media on :3006 (HTTP + thumbnail worker)
 *   pnpm nx e2e media-e2e
 *
 * Env override: MEDIA_BASE_URL (default http://localhost:3006/api/v1).
 *
 * Asserts: (1) create-upload → PUT the bytes to the returned presigned URL →
 * complete → poll GET until READY → the presigned original + thumbnail URLs both
 * fetch 200 and the thumbnail is smaller than the original; (2) a disallowed MIME
 * and an over-size upload are rejected at create-upload (no URL issued); (3)
 * tenant isolation — tenant B cannot complete or get tenant A's object.
 */
const MEDIA_BASE_URL = process.env.MEDIA_BASE_URL ?? 'http://localhost:3006/api/v1';

const tenantA = '77777777-7777-4777-8777-777777777777';
const tenantB = '88888888-8888-4888-8888-888888888888';

// Mimics what the gateway stamps after verifying a token.
const headersFor = (tenantId: string): Record<string, string> => ({
  'content-type': 'application/json',
  'x-tenant-id': tenantId,
  'x-user-id': `user-${tenantId.slice(0, 8)}`,
  'x-roles': 'customer',
});

interface CreateUploadResponse {
  id: string;
  objectKey: string;
  uploadUrl: string;
}
interface MediaResponse {
  id: string;
  status: 'PENDING' | 'UPLOADED' | 'READY';
  url: string;
  thumbnailUrl?: string;
}

async function waitUntil<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== undefined) {
      return result;
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for media to become READY');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function contentLength(url: string): Promise<number> {
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const body = Buffer.from(await res.arrayBuffer());
  return body.length;
}

describe('Media upload → thumbnail → presigned get (e2e, compose)', () => {
  it('uploads directly to MinIO, generates a smaller thumbnail, and serves both via presigned URLs', async () => {
    const png = makePng(512, 512);

    // 1) create-upload → PENDING row + presigned PUT.
    const createRes = await fetch(`${MEDIA_BASE_URL}/media/uploads`, {
      method: 'POST',
      headers: headersFor(tenantA),
      body: JSON.stringify({ contentType: 'image/png', sizeBytes: png.length }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as CreateUploadResponse;
    expect(created.objectKey.startsWith(`${tenantA}/`)).toBe(true);

    // 2) Client PUTs the bytes DIRECTLY to the presigned URL (app never proxies).
    const putRes = await fetch(created.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: png,
    });
    expect(putRes.status).toBe(200);

    // 3) complete → verifies the object exists → UPLOADED → enqueues thumbnail.
    const completeRes = await fetch(`${MEDIA_BASE_URL}/media/uploads/${created.id}/complete`, {
      method: 'POST',
      headers: headersFor(tenantA),
    });
    expect(completeRes.status).toBe(201);

    // 4) Poll GET until the worker marks it READY with a thumbnail URL.
    const ready = await waitUntil(async () => {
      const res = await fetch(`${MEDIA_BASE_URL}/media/${created.id}`, {
        headers: headersFor(tenantA),
      });
      if (res.status !== 200) {
        return undefined;
      }
      const media = (await res.json()) as MediaResponse;
      return media.status === 'READY' && media.thumbnailUrl ? media : undefined;
    });

    // 5) Both presigned GET URLs actually fetch, and the thumbnail is smaller.
    const originalSize = await contentLength(ready.url);
    const thumbnailSize = await contentLength(ready.thumbnailUrl as string);
    expect(thumbnailSize).toBeLessThan(originalSize);
  }, 60_000);

  it('rejects a disallowed MIME and an over-size upload before issuing a URL', async () => {
    const disallowed = await fetch(`${MEDIA_BASE_URL}/media/uploads`, {
      method: 'POST',
      headers: headersFor(tenantA),
      body: JSON.stringify({ contentType: 'application/pdf', sizeBytes: 1_000 }),
    });
    expect(disallowed.status).toBe(400);

    const oversize = await fetch(`${MEDIA_BASE_URL}/media/uploads`, {
      method: 'POST',
      headers: headersFor(tenantA),
      body: JSON.stringify({ contentType: 'image/png', sizeBytes: 50_000_000 }),
    });
    expect(oversize.status).toBe(400);
  });

  it('isolates tenants: tenant B cannot complete or get tenant A’s object', async () => {
    const png = makePng(64, 64);
    const createRes = await fetch(`${MEDIA_BASE_URL}/media/uploads`, {
      method: 'POST',
      headers: headersFor(tenantA),
      body: JSON.stringify({ contentType: 'image/png', sizeBytes: png.length }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as CreateUploadResponse;

    await fetch(created.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: png,
    });

    // Tenant B sees the row as non-existent (tenant-scoped lookup) → 404 on both.
    const completeAsB = await fetch(`${MEDIA_BASE_URL}/media/uploads/${created.id}/complete`, {
      method: 'POST',
      headers: headersFor(tenantB),
    });
    expect(completeAsB.status).toBe(404);

    const getAsB = await fetch(`${MEDIA_BASE_URL}/media/${created.id}`, {
      headers: headersFor(tenantB),
    });
    expect(getAsB.status).toBe(404);
  }, 30_000);
});
