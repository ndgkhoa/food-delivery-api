import type { Observable } from 'rxjs';

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

export interface InventoryGrpcService {
  reserve(
    request: ReserveRequest,
  ): Promise<ReserveResponse> | Observable<ReserveResponse> | ReserveResponse;
  release(
    request: ReleaseRequest,
  ): Promise<ReleaseResponse> | Observable<ReleaseResponse> | ReleaseResponse;
}

export interface InventoryGrpcClient {
  reserve(request: ReserveRequest): Observable<ReserveResponse>;
  release(request: ReleaseRequest): Observable<ReleaseResponse>;
}
