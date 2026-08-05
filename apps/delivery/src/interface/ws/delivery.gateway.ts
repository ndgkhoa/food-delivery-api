import { GetAssignmentQuery } from '@delivery/application/get-assignment.query';
import { LocationUpdateHandler } from '@delivery/application/location-update.handler';
import { createLocation, InvalidLocationError } from '@delivery/domain/delivery/location';
import { extractHandshakeToken } from '@delivery/interface/ws/handshake-token';
import { LocationRateLimiter } from '@delivery/interface/ws/location-rate-limiter';
import { orderRoom, WS_EVENTS } from '@delivery/interface/ws/realtime-channels';
import { AccessTokenVerifier, type VerifiedIdentity } from '@food-delivery-api/shared-jwt';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

const DRIVER_ROLE = 'driver';

interface DeliverySocketData {
  identity: VerifiedIdentity;
  rateLimiter: LocationRateLimiter;
}

type DeliverySocket = Socket & { data: Partial<DeliverySocketData> };

@Injectable()
@WebSocketGateway({ cors: { origin: '*' } })
export class DeliveryGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger(DeliveryGateway.name);
  private readonly rateLimitPerSec: number;

  @WebSocketServer() private readonly server!: Server;

  constructor(
    private readonly verifier: AccessTokenVerifier,
    private readonly locationUpdate: LocationUpdateHandler,
    private readonly getAssignment: GetAssignmentQuery,
    config: ConfigService,
  ) {
    this.rateLimitPerSec = config.getOrThrow<number>('DRIVER_LOCATION_RATE_LIMIT_PER_SEC');
  }

  afterInit(server: Server): void {
    server.use(async (client: DeliverySocket, next: (err?: Error) => void) => {
      try {
        const token = extractHandshakeToken(client.handshake);
        if (!token) {
          throw new Error('missing handshake token');
        }
        client.data.identity = await this.verifier.verify(token);
        client.data.rateLimiter = new LocationRateLimiter(this.rateLimitPerSec);
        next();
      } catch (error) {
        this.logger.warn(
          `Rejected WS handshake: ${error instanceof Error ? error.message : String(error)}`,
        );
        next(new Error('unauthenticated'));
      }
    });
  }

  async handleDisconnect(client: DeliverySocket): Promise<void> {
    const identity = client.data.identity;
    if (identity?.roles.includes(DRIVER_ROLE)) {
      await this.locationUpdate.goOffline(identity.tenantId, identity.sub);
    }
  }

  @SubscribeMessage(WS_EVENTS.LOCATION)
  async onLocation(client: DeliverySocket, payload: unknown): Promise<void> {
    const identity = client.data.identity;
    const rateLimiter = client.data.rateLimiter;
    if (!identity || !rateLimiter) {
      return;
    }
    if (!identity.roles.includes(DRIVER_ROLE)) {
      client.emit(WS_EVENTS.ERROR, { message: 'location requires the driver role' });
      return;
    }
    if (!rateLimiter.allow()) {
      return;
    }

    let location: ReturnType<typeof createLocation>;
    try {
      const body = (payload ?? {}) as { lat?: unknown; lng?: unknown };
      location = createLocation(body.lat, body.lng);
    } catch (error) {
      if (error instanceof InvalidLocationError) {
        client.emit(WS_EVENTS.ERROR, { message: error.message });
        return;
      }
      throw error;
    }

    const orderIds = await this.locationUpdate.execute(identity.tenantId, identity.sub, location);
    for (const orderId of orderIds) {
      this.server
        .to(orderRoom(identity.tenantId, orderId))
        .emit(WS_EVENTS.LOCATION, { driverId: identity.sub, lat: location.lat, lng: location.lng });
    }
  }

  @SubscribeMessage(WS_EVENTS.JOIN_ORDER)
  async onJoinOrder(client: DeliverySocket, payload: unknown): Promise<void> {
    const identity = client.data.identity;
    if (!identity) {
      return;
    }
    const orderId = (payload as { orderId?: unknown } | null)?.orderId;
    if (typeof orderId !== 'string' || orderId.length === 0) {
      client.emit(WS_EVENTS.ERROR, { message: 'orderId is required' });
      return;
    }
    const assignment = await this.getAssignment.execute(identity.tenantId, orderId);
    if (!assignment) {
      client.emit(WS_EVENTS.ERROR, { message: 'order is not assigned or not permitted' });
      return;
    }
    await client.join(orderRoom(identity.tenantId, orderId));
    client.emit(WS_EVENTS.JOINED, { orderId });
  }

  broadcastAssignment(tenantId: string, orderId: string, driverId: string): void {
    this.server.to(orderRoom(tenantId, orderId)).emit(WS_EVENTS.ASSIGNED, { orderId, driverId });
  }
}
