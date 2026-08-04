import { Client, errors } from '@elastic/elasticsearch';
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

    try {
      await this.client.indices.create({
        index: RESTAURANTS_INDEX,
        settings: RESTAURANT_INDEX_SETTINGS,
        mappings: RESTAURANT_INDEX_MAPPINGS,
      });
      this.logger.log(
        `Created index ${RESTAURANTS_INDEX} (vn_text analyzer + autocomplete + rating)`,
      );
    } catch (error) {
      if (
        error instanceof errors.ResponseError &&
        error.body?.error?.type === 'resource_already_exists_exception'
      ) {
        this.logger.log(`Index ${RESTAURANTS_INDEX} created concurrently by another instance`);
        return;
      }
      throw error;
    }
  }
}
