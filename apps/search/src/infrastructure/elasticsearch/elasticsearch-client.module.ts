import { Client } from '@elastic/elasticsearch';
import { Inject, Module, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ELASTICSEARCH_CLIENT } from '@search/infrastructure/elasticsearch/elasticsearch.tokens';

const elasticsearchClientProvider: Provider = {
  provide: ELASTICSEARCH_CLIENT,
  useFactory: (config: ConfigService): Client =>
    new Client({ node: config.getOrThrow<string>('ELASTICSEARCH_NODE') }),
  inject: [ConfigService],
};

@Module({
  providers: [elasticsearchClientProvider],
  exports: [ELASTICSEARCH_CLIENT],
})
export class ElasticsearchClientModule implements OnApplicationShutdown {
  constructor(@Inject(ELASTICSEARCH_CLIENT) private readonly client: Client) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
