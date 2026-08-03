module.exports = {
  displayName: 'payment',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // uuid v14 is ESM-only and is pulled in transitively by @temporalio; by default
  // Jest never transforms node_modules, so its `export` syntax crashes the CJS
  // test runtime. Carve uuid out of the ignore list so ts-jest (with allowJs)
  // down-levels it to CommonJS. pnpm nests it under .pnpm/uuid@x/node_modules/uuid.
  transformIgnorePatterns: ['node_modules/(?!(\\.pnpm/)?uuid)'],
  coverageDirectory: '../../coverage/apps/payment',
  // Unit gate only — DB/broker integration lives in the compose-based saga e2e.
  testPathIgnorePatterns: ['/node_modules/', '\\.e2e-spec\\.ts$'],
  testTimeout: 30000,
};
