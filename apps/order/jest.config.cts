module.exports = {
  displayName: 'order',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/order',
  // Unit gate only — DB/gRPC integration lives in `order-e2e` and runs via
  // `nx e2e order-e2e`, so `nx test order` never spins containers.
  testPathIgnorePatterns: ['/node_modules/', '\\.e2e-spec\\.ts$'],
  testTimeout: 30000,
};
