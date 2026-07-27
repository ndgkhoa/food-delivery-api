import type { Observable } from 'rxjs';

/**
 * Hand-written TypeScript shapes for the `inventory.proto` messages (camelCase
 * to match `@grpc/proto-loader` with `keepCase: false`).
 */
export interface ReserveItemMessage {
  itemId: string;
  qty: number;
}

export interface ReserveRequest {
  tenantId: string;
  orderId: string;
  items: ReserveItemMessage[];
}

export interface ReserveResponse {
  ok: boolean;
  reservationIds: string[];
}

export interface ReleaseRequest {
  tenantId: string;
  orderId: string;
}

export interface ReleaseResponse {
  ok: boolean;
}

/** Server-side contract a NestJS gRPC controller implements. */
export interface InventoryGrpcService {
  reserve(
    request: ReserveRequest,
  ): Promise<ReserveResponse> | Observable<ReserveResponse> | ReserveResponse;
  release(
    request: ReleaseRequest,
  ): Promise<ReleaseResponse> | Observable<ReleaseResponse> | ReleaseResponse;
}

/**
 * Client-side contract (methods return Observables under NestJS's gRPC client).
 * Used by the order service in the next slice and by integration tests here.
 */
export interface InventoryGrpcClient {
  reserve(request: ReserveRequest): Observable<ReserveResponse>;
  release(request: ReleaseRequest): Observable<ReleaseResponse>;
}
