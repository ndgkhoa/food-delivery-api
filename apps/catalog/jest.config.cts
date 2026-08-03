module.exports = {
  displayName: 'catalog',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/catalog',
  testPathIgnorePatterns: ['/node_modules/', '\\.e2e-spec\\.ts$'],
  testTimeout: 30000,
};
