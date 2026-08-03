module.exports = {
  displayName: 'inventory',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/inventory',
  // Unit gate only — DB/Redis/gRPC integration lives in `inventory-e2e` and runs
  // via `nx e2e inventory-e2e`, so `nx test inventory` never spins containers.
  testPathIgnorePatterns: ['/node_modules/', '\\.e2e-spec\\.ts$'],
  testTimeout: 30000,
};
