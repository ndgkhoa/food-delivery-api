/**
 * Deterministic object-key scheme. Keys are tenant-prefixed (`{tenantId}/{id}`)
 * so a presigned URL is scoped to one tenant's namespace and one object; the
 * thumbnail key derives from the same pair, keeping thumbnail generation
 * idempotent (a re-run always targets the same key).
 */
export function buildObjectKey(tenantId: string, id: string): string {
  return `${tenantId}/${id}`;
}

export function buildThumbnailKey(tenantId: string, id: string): string {
  return `${tenantId}/${id}_thumb`;
}
