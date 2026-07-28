import type { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  type EventEnvelopeHeaders,
  IdempotentConsumer,
  KafkaConsumerSubscriber,
  PROCESSED_EVENT_STORE,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import { ReleaseStockHandler } from '@inventory/application/reservation/commands/release-stock.handler';
import { ReserveStockHandler } from '@inventory/application/reservation/commands/reserve-stock.handler';
import type { OutboxCommandEntry } from '@inventory/domain/shared/outbox.port';
import { OUTBOX_WRITER, type OutboxWriter } from '@inventory/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@inventory/domain/shared/transaction.port';
import {
  RELEASE_STOCK,
  RESERVE_STOCK,
  stockReleasedReply,
  stockReservationFailedReply,
  stockReservedReply,
} from '@inventory/interface/messaging/inventory-reply-factory';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const INVENTORY_COMMANDS_TOPIC = 'inventory.commands';
const CONSUMER_GROUP_ID = 'inventory-commands';

interface ReserveCommandPayload {
  orderId: string;
  items: { itemId: string; qty: number }[];
}

interface ReleaseCommandPayload {
  orderId: string;
}

/**
 * Consumes `inventory.commands` and replies over the outbox. The reserve/release
 * use cases are already idempotent by order id (atomic conditional decrement +
 * ACTIVE-hold gate), so they run in their own locked transaction first; the
 * REPLY is then appended under a `processed_events` dedupe keyed by the command
 * event id, so a re-delivered command replies at most once. Disabled under
 * NODE_ENV=test (no broker). The subscriber re-establishes tenant scope from the
 * command header before the handler runs.
 */
@Injectable()
export class InventoryCommandConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InventoryCommandConsumer.name);
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    private readonly reserveStock: ReserveStockHandler,
    private readonly releaseStock: ReleaseStockHandler,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(PROCESSED_EVENT_STORE) private readonly processedEvents: ProcessedEventStorePort,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn('Inventory command consumer disabled (NODE_ENV=test)');
      return;
    }
    this.consumer = await this.subscriber.subscribe({
      groupId: CONSUMER_GROUP_ID,
      topics: [INVENTORY_COMMANDS_TOPIC],
      handler: ({ envelope, payload }) => this.handleCommand(envelope, payload),
    });
    this.logger.log(`Consuming ${INVENTORY_COMMANDS_TOPIC} for the order saga`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }

  private async handleCommand(envelope: EventEnvelopeHeaders, payload: unknown): Promise<void> {
    const reply = await this.runEffect(envelope, payload);
    // Effect done (idempotent); append the reply once per command event id.
    await this.transaction.runInTransaction(async () => {
      await IdempotentConsumer.runOnce(this.processedEvents, envelope.eventId, undefined, () =>
        this.outbox.append(reply),
      );
    });
  }

  private async runEffect(
    envelope: EventEnvelopeHeaders,
    payload: unknown,
  ): Promise<OutboxCommandEntry> {
    const { tenantId, eventType } = envelope;
    if (eventType === RESERVE_STOCK) {
      const command = payload as ReserveCommandPayload;
      const result = await this.reserveStock.execute({
        tenantId,
        orderId: command.orderId,
        items: command.items,
      });
      return result.ok
        ? stockReservedReply(command.orderId)
        : stockReservationFailedReply(command.orderId, 'insufficient stock');
    }
    if (eventType === RELEASE_STOCK) {
      const command = payload as ReleaseCommandPayload;
      await this.releaseStock.execute({ tenantId, orderId: command.orderId });
      return stockReleasedReply(command.orderId);
    }
    throw new Error(`Unknown inventory command type "${eventType}"`);
  }
}
