import { existsSync } from 'node:fs';
import { catalogProtoPath } from './proto-paths';

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: jest.fn(),
}));

describe('catalogProtoPath', () => {
  afterEach(() => {
    jest.mocked(existsSync).mockReset();
  });

  it('resolves to a candidate path that exists on disk', () => {
    jest
      .mocked(existsSync)
      .mockImplementation((candidate) => String(candidate).endsWith('catalog.proto'));

    expect(catalogProtoPath()).toContain('catalog.proto');
  });

  it('throws a descriptive error listing every candidate location when none exist', () => {
    jest.mocked(existsSync).mockReturnValue(false);

    expect(() => catalogProtoPath()).toThrow(/proto file "catalog\.proto" not found/);
  });
});
