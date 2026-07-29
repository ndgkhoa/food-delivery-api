module.exports = {
  displayName: 'payment-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  // e2e specs use the .e2e-spec.ts suffix (default testMatch only catches *.spec.ts).
  testMatch: ['<rootDir>/src/**/*.e2e-spec.ts'],
  coverageDirectory: '../../coverage/apps/payment-e2e',
  testTimeout: 180000,
  // Serial: the durable-charge scenarios share the compose stack (Temporal +
  // Kafka + payment worker) and a single reply topic.
  maxWorkers: 1,
};
