import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ROLES_METADATA = 'shared-tenancy:required-roles';

export const Roles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES_METADATA, roles);
