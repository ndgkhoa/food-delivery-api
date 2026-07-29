module.exports = {
  displayName: 'notification-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  // e2e specs use the .e2e-spec.ts suffix (default testMatch only catches *.spec.ts).
  testMatch: ['<rootDir>/src/**/*.e2e-spec.ts'],
  coverageDirectory: '../../coverage/apps/notification-e2e',
  testTimeout: 180000,
  // Serial: the dispatch/DLQ scenarios share the compose stack (Kafka + Postgres +
  // Mailpit + the notification worker) and the same order.events topic.
  maxWorkers: 1,
};
