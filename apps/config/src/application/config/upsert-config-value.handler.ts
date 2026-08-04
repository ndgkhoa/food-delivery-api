import { randomUUID } from 'node:crypto';
import { ConfigEntry } from '@config/domain/config/config-entry';
import {
  CONFIG_ENTRY_REPOSITORY,
  type ConfigEntryRepository,
} from '@config/domain/config/config-entry.repository';
import {
  CONFIG_EVENT_PUBLISHER,
  type ConfigEventPublisherPort,
} from '@config/domain/config/config-event';
import { CONFIG_PLATFORM_ADMIN_ROLE } from '@config/domain/config/config-roles';
import { GlobalWriteRequiresPlatformAdminError } from '@config/domain/shared/errors';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable, Logger } from '@nestjs/common';

export interface UpsertConfigValueCommand {
  key: string;
  value: number;
  global: boolean;
}

@Injectable()
export class UpsertConfigValueHandler {
  private readonly logger = new Logger(UpsertConfigValueHandler.name);

  constructor(
    @Inject(CONFIG_ENTRY_REPOSITORY) private readonly repository: ConfigEntryRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(CONFIG_EVENT_PUBLISHER) private readonly publisher: ConfigEventPublisherPort,
  ) {}

  async execute(command: UpsertConfigValueCommand): Promise<number> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const roles = this.tenantContext.getContext()?.roles ?? [];

    if (command.global && !roles.includes(CONFIG_PLATFORM_ADMIN_ROLE)) {
      throw new GlobalWriteRequiresPlatformAdminError();
    }
    const targetTenantId = command.global ? null : tenantId;

    const existing = targetTenantId
      ? await this.repository.findTenantEntry(targetTenantId, command.key)
      : await this.repository.findGlobalEntry(command.key);

    const entry = existing
      ? existing.withValue(command.value)
      : ConfigEntry.create({
          id: randomUUID(),
          tenantId: targetTenantId,
          key: command.key,
          value: command.value,
        });

    const saved = await this.repository.upsert(entry);

    await this.publisher
      .publishValueChanged({ tenantId: saved.tenantId, key: saved.key })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to publish ConfigValueChanged for "${saved.key}": ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    return saved.value;
  }
}
