const nxPreset = require('@nx/jest/preset').default;

module.exports = {
  ...nxPreset,
  coveragePathIgnorePatterns: [
    ...(nxPreset.coveragePathIgnorePatterns ?? ['/node_modules/']),
    '/migrations/',
    '/src/testing/',
    '/main\\.ts$',
    '\\.module\\.ts$',
    '\\.generated\\.ts$',
    '\\.g\\.ts$',
    '\\.d\\.ts$',
    '/index\\.ts$',
    '/instrumentation\\.ts$',
    '/typeorm-options\\.ts$',
  ],
};
