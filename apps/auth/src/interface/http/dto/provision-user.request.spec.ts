import {
  PROVISIONABLE_ROLES,
  ProvisionUserRequest,
} from '@auth/interface/http/dto/provision-user.request';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('ProvisionUserRequest validation', () => {
  const base = {
    username: 'olivia',
    email: 'olivia@acme.test',
    password: 'sup3r-secret',
  };

  it('rejects a role outside the provisionable set', async () => {
    const dto = plainToInstance(ProvisionUserRequest, { ...base, role: 'superadmin' });

    const errors = await validate(dto);

    const roleError = errors.find((e) => e.property === 'role');
    expect(roleError).toBeDefined();
    expect(roleError?.constraints).toHaveProperty('isIn');
  });

  it.each(PROVISIONABLE_ROLES)('accepts the recognised role "%s"', async (role) => {
    const dto = plainToInstance(ProvisionUserRequest, { ...base, role });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
