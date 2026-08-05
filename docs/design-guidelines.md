# Design Guidelines

API design conventions, REST resource patterns, error handling, pagination, and versioning strategies.

## REST API Design Principles

### Base URL & Versioning

```
https://api.food-delivery.local/api/v1
```

- **Protocol:** HTTPS (TLS 1.2+)
- **Hostname:** Domain-based (not path-based for simpler proxying)
- **Version:** URL path versioning (`/api/v1`, `/api/v2`, etc.)
- **Rationale:** Allows backward compatibility; clients control upgrade timing

**Version Lifecycle:**
- v1 (current): Bug fixes only; 18-month support window
- v2 (planned): New features; breaking changes allowed
- Deprecation: 6-month sunset notice before removal

### Resource Naming

Use **plural nouns** for collections; support nested resources for clarity:

```
GET    /api/v1/restaurants                      # List all restaurants
POST   /api/v1/restaurants                      # Create restaurant
GET    /api/v1/restaurants/{id}                 # Get one restaurant
PATCH  /api/v1/restaurants/{id}                 # Partial update
DELETE /api/v1/restaurants/{id}                 # Delete restaurant

GET    /api/v1/restaurants/{id}/menu-items      # List menu items for restaurant
GET    /api/v1/restaurants/{id}/menu-items/{id} # Get one menu item
POST   /api/v1/restaurants/{id}/menu-items      # Create menu item

GET    /api/v1/restaurants/{id}/reviews         # List reviews for restaurant
```

**Exceptions (RPC-style endpoints):**
- Actions (non-CRUD operations): `/api/v1/search/rebuild` (POST to rebuild index)
- Aggregations: `/api/v1/analytics/revenue` (GET tenant revenue summary)

### HTTP Methods & Status Codes

| Method | Purpose | Response | Idempotent |
|--------|---------|----------|-----------|
| **GET** | Retrieve resource(s) | 200 OK or 404 Not Found | Yes |
| **POST** | Create new resource | 201 Created or 400 Bad Request | No |
| **PATCH** | Partial update | 200 OK or 400/404/409 | No* |
| **DELETE** | Delete resource | 204 No Content or 404 Not Found | Yes |

*PATCH is idempotent if using conditional requests (If-Match: ETag).

**Status Codes:**

| Code | Use Case |
|------|----------|
| **200 OK** | Successful GET, PATCH, DELETE (with body) |
| **201 Created** | Successful POST (location header required) |
| **204 No Content** | Successful DELETE (no body) |
| **400 Bad Request** | Validation error (malformed JSON, invalid field) |
| **401 Unauthorized** | Missing/invalid JWT token |
| **403 Forbidden** | Valid token but insufficient permissions |
| **404 Not Found** | Resource doesn't exist |
| **409 Conflict** | Duplicate key, stale ETag, or business rule violation |
| **429 Too Many Requests** | Rate limit exceeded |
| **500 Internal Server Error** | Unhandled exception |
| **503 Service Unavailable** | Downstream dependency unavailable (circuit breaker open) |

### Request/Response Envelope

**Standard Success Response:**

```json
{
  "data": {
    "id": "order-123",
    "customerId": "customer-456",
    "restaurantId": "restaurant-789",
    "status": "CONFIRMED",
    "items": [
      { "menuItemId": "item-1", "name": "Pizza", "quantity": 2, "price": 12.99 }
    ],
    "totalAmount": 25.98,
    "createdAt": "2025-08-04T12:30:00Z",
    "updatedAt": "2025-08-04T12:35:00Z"
  },
  "meta": {
    "requestId": "req-abc123",
    "timestamp": "2025-08-04T12:35:00Z"
  }
}
```

**Standard Error Response:**

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "items": "At least one item required",
    "customerId": "Invalid UUID format"
  },
  "meta": {
    "requestId": "req-abc123",
    "timestamp": "2025-08-04T12:35:00Z"
  }
}
```

**Error Code Enum:**

```typescript
enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
}
```

### Field Naming (camelCase)

All JSON fields use **camelCase**; database columns use **snake_case** (TypeORM handles mapping):

```typescript
// API Response (camelCase)
{
  "restaurantId": "rest-123",
  "restaurantName": "Pizza Palace",
  "createdAt": "2025-08-04T12:00:00Z",
  "averageRating": 4.5
}

// Database Column (snake_case)
restaurant_id: string;
restaurant_name: string;
created_at: timestamp;
average_rating: float;
```

## Request Handling

### Required Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `Authorization` | `Bearer {jwt-token}` | JWT token from Keycloak |
| `Content-Type` | `application/json` | JSON request body |
| `Accept` | `application/json` | Expected response format |
| `User-Agent` | Client identifier | For analytics |

### Optional Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `Idempotency-Key` | UUID | Request deduplication |
| `X-Request-ID` | UUID | Request tracing (auto-generated if missing) |
| `X-Tenant-ID` | UUID | Explicit tenant override (admin only) |

**Idempotency-Key Header:**

Used to make POST requests idempotent (prevents duplicate processing on retry):

```bash
POST /api/v1/orders \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d { "customerId": "...", "restaurantId": "...", ... }

# First call: 201 Created (order created)
# Retry with same key: 200 OK (returns existing order, no duplicate)
```

**Implementation:** Server stores (Idempotency-Key → OrderId) mapping in database; subsequent calls return cached result.

### Timestamps

All timestamps use **ISO 8601** format with timezone (UTC):

```json
"createdAt": "2025-08-04T12:30:00Z"
"updatedAt": "2025-08-04T12:35:00.123Z"
```

Never send unaware (no timezone) timestamps.

## Pagination

### Query Parameters

```
GET /api/v1/orders?page=2&limit=20&sortBy=createdAt&sortOrder=desc
```

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `page` | integer | 1 | ≥ 1 | Page number (1-indexed) |
| `limit` | integer | 20 | 1–100 | Items per page |
| `sortBy` | string | createdAt | Enum | Sort column |
| `sortOrder` | string | desc | asc/desc | Sort direction |

### Pagination Response

```json
{
  "data": [
    { "id": "order-1", "status": "CONFIRMED", ... },
    { "id": "order-2", "status": "PENDING", ... }
  ],
  "pagination": {
    "page": 2,
    "limit": 20,
    "total": 157,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPreviousPage": true
  },
  "meta": {
    "requestId": "req-abc123",
    "timestamp": "2025-08-04T12:35:00Z"
  }
}
```

### Performance Notes

- **Offset-based pagination** (current) — Simple; inefficient for large offsets
- **Cursor-based pagination** (v2 future) — More efficient; use encoded cursor for next page

For now, limit offsets to 1000 (enforced: `limit * page ≤ 1000`).

## Filtering

### Query String Filters

```
GET /api/v1/orders?status=CONFIRMED&customerId=customer-123&createdAfter=2025-08-01
```

| Filter | Type | Operators | Example |
|--------|------|-----------|---------|
| `status` | enum | = | `status=CONFIRMED` |
| `customerId` | UUID | = | `customerId=cust-123` |
| `restaurantId` | UUID | = | `restaurantId=rest-456` |
| `createdAfter` | ISO date | ≥ | `createdAfter=2025-08-01T00:00:00Z` |
| `createdBefore` | ISO date | ≤ | `createdBefore=2025-08-31T23:59:59Z` |
| `minAmount` | decimal | ≥ | `minAmount=10.00` |
| `maxAmount` | decimal | ≤ | `maxAmount=100.00` |
| `q` | string | contains | `q=pizza` (for search) |

**URL Encoding:** Special characters (space, &, =) must be URL-encoded.

## Caching

### Cache-Control Headers

```
Cache-Control: public, max-age=300, s-maxage=600
```

| Directive | Applies To | Meaning |
|-----------|-----------|---------|
| `public` | Client + CDN | Cache is public (not private) |
| `private` | Client only | Cache only on client (no CDN) |
| `max-age=300` | Client | Cache for 5 minutes |
| `s-maxage=600` | CDN | CDN cache for 10 minutes |
| `no-cache` | All | Revalidate before use (no automatic stale use) |
| `no-store` | All | Never cache (sensitive data) |

**Cache Strategies:**

| Endpoint | Strategy | TTL | Notes |
|----------|----------|-----|-------|
| GET list endpoints | public | 300s | Safe to cache; use ETag for revalidation |
| GET single resource | public | 60s | Shorter TTL; more frequently updated |
| POST/PATCH/DELETE | no-cache | 0 | Never cache mutations |
| Authentication endpoints | no-store | 0 | Sensitive; never cache |

### ETags

Used for conditional requests (prevent redundant data transfer):

```bash
# First request
GET /api/v1/orders/order-123
Response:
  ETag: "W/\"abc123\""
  Cache-Control: public, max-age=300

# Retry with ETag
GET /api/v1/orders/order-123
If-None-Match: "W/\"abc123\""
Response:
  304 Not Modified (no body; use cached version)
```

## Rate Limiting

### Per-Client Rate Limit

Enforced by API Gateway:

```
100 requests per 60 seconds (per client IP + user ID)
```

**Response Headers:**

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1722777300
```

**Exceeded:**

```json
{
  "statusCode": 429,
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded. Retry after 30 seconds.",
  "meta": {
    "requestId": "req-abc123",
    "retryAfter": 30
  }
}
```

### Rate Limit Bypass

Admin requests bypass rate limiting (via OAuth scope `admin`).

## Async Operations

For long-running operations, return immediate 202 Accepted + polling URL:

```bash
POST /api/v1/search/rebuild
Response:
  202 Accepted
  {
    "jobId": "job-abc123",
    "status": "QUEUED",
    "pollingUrl": "/api/v1/jobs/job-abc123"
  }

# Poll for completion
GET /api/v1/jobs/job-abc123
Response:
  {
    "jobId": "job-abc123",
    "status": "COMPLETED",
    "result": { "indexedCount": 1234 }
  }
```

## Search API

### Full-Text Search

```
GET /api/v1/search/restaurants?q=pizza&coordinates=40.7128,-74.0060
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Full-text search query |
| `coordinates` | lat,lng | Sort by proximity (GEO) |
| `radius` | number | Search radius in km (default 10) |
| `page` | integer | Pagination |
| `limit` | integer | Results per page |

**Response:**

```json
{
  "data": [
    {
      "id": "rest-123",
      "name": "Pizza Palace",
      "description": "Best pizza in town",
      "averageRating": 4.5,
      "totalReviews": 234,
      "distance": 1.2
    }
  ],
  "pagination": { ... }
}
```

### Autocomplete

```
GET /api/v1/search/autocomplete?q=piz
```

Returns suggestions with minimal payload:

```json
{
  "data": [
    { "id": "rest-123", "name": "Pizza Palace" },
    { "id": "rest-456", "name": "Pizza Hut" }
  ]
}
```

## Media Upload

### Two-Step Upload (Presigned URL)

**Step 1: Create upload session**

```bash
POST /api/v1/media/upload
{
  "fileName": "restaurant-photo.jpg",
  "contentType": "image/jpeg"
}

Response:
{
  "mediaId": "media-123",
  "uploadUrl": "https://minio.local/food-delivery/media-123?X-Amz-Signature=...",
  "expiresIn": 3600
}
```

**Step 2: Direct upload to MinIO**

```bash
PUT {uploadUrl} \
  -H "Content-Type: image/jpeg" \
  --data-binary @restaurant-photo.jpg

Response: 200 OK
```

**Step 3: Complete upload**

```bash
POST /api/v1/media/media-123/complete
{
  "metadata": {
    "entityType": "restaurant",
    "entityId": "rest-123"
  }
}

Response:
{
  "mediaId": "media-123",
  "status": "READY",
  "url": "https://cdn.food-delivery.local/media-123"
}
```

**Benefits:**
- No server-side storage (bandwidth savings)
- Client-side retry logic (resumable)
- Async thumbnail generation (doesn't block response)

## Versioning & Breaking Changes

### API Evolution Strategy

1. **Non-breaking changes** (automatic):
   - New optional fields
   - New endpoints
   - New query parameters
   - Stricter validation (reject previously invalid input)

2. **Breaking changes** (requires new version):
   - Remove/rename fields
   - Change response structure
   - Remove/rename endpoints
   - Change error codes
   - Change status code meanings

3. **Deprecation Process**:
   - Announce deprecation (6-month notice)
   - Mark endpoint as deprecated (response header: `Deprecation: true`)
   - Provide migration guide
   - Sunset old version (turn off)

### Example: v1 → v2 Migration

```bash
# v1 (deprecated)
GET /api/v1/restaurants/{id}
{
  "id": "...",
  "name": "...",
  "photo": { url: "..." }  # Nested structure
}

# v2 (new structure)
GET /api/v2/restaurants/{id}
{
  "id": "...",
  "name": "...",
  "photoId": "...",        # Moved to separate endpoint
  "photoUrl": "..."        # Flattened
}

# Get photo separately in v2
GET /api/v2/restaurants/{id}/photo
{
  "mediaId": "...",
  "url": "...",
  "format": "jpg"
}
```

## Documentation

### API Reference

**Scalar (Built-in):** http://localhost:3000/api/v1/reference

Auto-generated from NestJS Swagger decorators:

```typescript
@Post('/orders')
@ApiOperation({ summary: 'Place an order' })
@ApiCreatedResponse({ description: 'Order created', type: OrderDto })
@ApiBadRequestResponse({ description: 'Validation error' })
async placeOrder(@Body() dto: PlaceOrderDto): Promise<OrderDto> {
  // ...
}
```

**Bruno Collection:** `bruno/` folder

Interactive HTTP requests with pre-configured auth + environments.

### Changelog

**Frequency:** Per release (via release-please)

**Format:**

```markdown
## [1.2.2] - 2025-08-04

### Added
- Multi-region deployment support (k8s manifests)
- Real-time driver tracking (WebSocket)

### Changed
- Order saga timeout reduced from 30s to 15s

### Fixed
- Catalog outbox duplication on transaction retry (#123)

### Deprecated
- `/api/v1/restaurants/search` endpoint (use `/api/v1/search/restaurants`)

### Security
- Updated Keycloak to 26.7 (security patches)
```

## Monitoring & Observability

### Key Metrics per Endpoint

```typescript
// Middleware records
- HTTP method + path
- Status code distribution
- Latency (p50, p99)
- Request body size
- Response body size
```

### Example SLOs

| Endpoint | Latency (p99) | Error Rate | Availability |
|----------|---------------|-----------|--------------|
| GET /api/v1/restaurants | 200ms | < 0.1% | 99.9% |
| POST /api/v1/orders | 5s | < 0.01% | 99.9% |
| GET /api/v1/search/restaurants | 500ms | < 0.1% | 99.5% |
| GET /api/v1/analytics/orders | 2s | < 0.5% | 99% |

## Security Considerations

### Input Validation

All requests validated against schema (Zod):

```typescript
export const PlaceOrderRequestSchema = z.object({
  restaurantId: z.string().uuid(),
  items: z.array(
    z.object({
      menuItemId: z.string().uuid(),
      quantity: z.number().int().min(1).max(50),
    })
  ).min(1).max(50),
});
```

### SQL Injection Prevention

TypeORM parameterized queries prevent SQL injection:

```typescript
// ✅ Safe (parameterized)
const orders = await db.query(
  'SELECT * FROM orders WHERE customer_id = $1',
  [customerId]
);

// ❌ Unsafe (string interpolation)
const orders = await db.query(
  `SELECT * FROM orders WHERE customer_id = '${customerId}'`
);
```

### CSRF Prevention

Stateless JWT authentication inherently immune to CSRF (no cookies).

### CORS

Configured per environment:

```typescript
const cors = process.env.NODE_ENV === 'production'
  ? { origin: process.env.ALLOWED_ORIGINS?.split(',') }
  : { origin: '*' };
```

**Production:** Only specified origins allowed
**Development:** All origins allowed

## Summary

| Aspect | Standard |
|--------|----------|
| **Base URL** | `/api/v1` (version in path) |
| **Naming** | Plural nouns + camelCase fields |
| **Pagination** | page + limit (1–100) |
| **Errors** | Standardized envelope + code enum |
| **Timestamps** | ISO 8601 with timezone (UTC) |
| **Caching** | Cache-Control headers + ETags |
| **Rate Limit** | 100/60s per client |
| **Media Upload** | Presigned URL (2-step) |
| **Versioning** | URL path (/api/v1, /api/v2) |
| **Security** | JWT + HTTPS + input validation |
| **Monitoring** | Prometheus + SLOs per endpoint |

For API testing, use the Bruno collection in `bruno/` folder.
