module.exports = {
  displayName: 'analytics-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  // e2e specs use the .e2e-spec.ts suffix (default testMatch only catches *.spec.ts).
  testMatch: ['<rootDir>/src/**/*.e2e-spec.ts'],
  coverageDirectory: '../../coverage/apps/analytics-e2e',
  testTimeout: 180000,
  // Serial: every scenario shares the compose stack (Kafka + ClickHouse + the
  // analytics service) and the same order.events topic / orders_fact table.
  maxWorkers: 1,
};
