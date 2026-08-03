module.exports = {
  displayName: 'notification',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/notification',
  // Unit gate only — Kafka/Redis/Postgres/Mailpit integration lives in the compose-based e2e.
  testPathIgnorePatterns: ['/node_modules/', '\\.e2e-spec\\.ts$'],
  testTimeout: 30000,
};
