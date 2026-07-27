module.exports = {
  displayName: 'gateway-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['<rootDir>/src/**/*.e2e-spec.ts'],
  coverageDirectory: '../../coverage/apps/gateway-e2e',
  testTimeout: 120000,
};
