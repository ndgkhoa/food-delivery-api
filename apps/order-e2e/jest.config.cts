module.exports = {
  displayName: 'order-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  // Default jest testMatch only catches *.spec.ts; e2e specs use the .e2e-spec.ts suffix.
  testMatch: ['<rootDir>/src/**/*.e2e-spec.ts'],
  coverageDirectory: '../../coverage/apps/order-e2e',
  testTimeout: 180000,
  // Each suite boots its own full stack (2 Postgres + Redis + an in-process
  // inventory gRPC server on a fixed port). Run suites serially so they don't
  // contend for that port or run many containers at once on a dev machine.
  maxWorkers: 1,
};
