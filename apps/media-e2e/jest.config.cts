module.exports = {
  displayName: 'media-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  // Default jest testMatch only catches *.spec.ts; e2e specs use the .e2e-spec.ts suffix.
  testMatch: ['<rootDir>/src/**/*.e2e-spec.ts'],
  coverageDirectory: '../../coverage/apps/media-e2e',
  testTimeout: 120000,
};
