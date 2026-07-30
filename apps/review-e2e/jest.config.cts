module.exports = {
  displayName: 'review-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  // e2e specs use the .e2e-spec.ts suffix (default testMatch only catches *.spec.ts).
  testMatch: ['<rootDir>/src/**/*.e2e-spec.ts'],
  coverageDirectory: '../../coverage/apps/review-e2e',
  testTimeout: 180000,
  // Serial: the submit/rating-propagation scenarios share the compose stack
  // (Kafka + Postgres + Elasticsearch + the review/catalog/search services)
  // and the same order.events/review.events topics.
  maxWorkers: 1,
};
