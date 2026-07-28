import { Client } from '@elastic/elasticsearch';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ELASTICSEARCH_CLIENT,
  RESTAURANTS_INDEX,
} from '@search/infrastructure/elasticsearch/elasticsearch.tokens';
import {
  RESTAURANT_INDEX_MAPPINGS,
  RESTAURANT_INDEX_SETTINGS,
} from '@search/infrastructure/elasticsearch/restaurant-index-definition';

/**
 * Creates the `restaurants` index (analyzer + synonym + edge-ngram autocomplete
 * + rating float) if it does not already exist. Elasticsearch is a read model
 * with no SQL migrations, so the schema is provisioned idempotently on boot:
 * create-if-absent, never mutate an existing index (analyzer/mapping changes
 * that need a reindex are an explicit later operation, not a silent boot effect).
 *
 * Skipped under NODE_ENV=test: in-process integration tests boot the module
 * graph without a live ES node. Logged (not silent) so a mis-set NODE_ENV in a
 * real environment is visible rather than a ghost that leaves the index missing.
 */
@Injectable()
export class RestaurantIndexBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(RestaurantIndexBootstrap.name);

  constructor(
    @Inject(ELASTICSEARCH_CLIENT) private readonly client: Client,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn(
        `Index bootstrap disabled (NODE_ENV=test): ${RESTAURANTS_INDEX} not created`,
      );
      return;
    }
    await this.ensureIndex();
  }

  private async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: RESTAURANTS_INDEX });
    if (exists) {
      this.logger.log(`Index ${RESTAURANTS_INDEX} already present`);
      return;
    }

    await this.client.indices.create({
      index: RESTAURANTS_INDEX,
      settings: RESTAURANT_INDEX_SETTINGS,
      mappings: RESTAURANT_INDEX_MAPPINGS,
    });
    this.logger.log(
      `Created index ${RESTAURANTS_INDEX} (vn_text analyzer + autocomplete + rating)`,
    );
  }
}
