export function buildObjectKey(tenantId: string, id: string): string {
  return `${tenantId}/${id}`;
}

export function buildThumbnailKey(tenantId: string, id: string): string {
  return `${tenantId}/${id}_thumb`;
}
