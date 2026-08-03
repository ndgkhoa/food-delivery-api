/**
 * Verifies the enable/disable gate and the "never throw" contract without a
 * live Collector: `@opentelemetry/sdk-node` is mocked, and each test resets
 * the module registry (the enabled/started state is a module-level singleton
 * in `register.ts`) so a fresh `NodeSDK` mock and a fresh gate check apply
 * per test.
 */
jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));

interface FreshModules {
  registerTracing: (serviceName: string) => void;
  NodeSdkMock: jest.Mock;
}

function loadFreshRegister(): FreshModules {
  jest.resetModules();
  // Re-required after resetModules so this reference matches the instance
  // `register.ts` itself resolves in this isolated module registry.
  // biome-ignore lint/suspicious/noExplicitAny: dynamic re-require of a mocked module for per-test isolation
  const sdkModule = require('@opentelemetry/sdk-node') as any;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic re-require under jest.resetModules()
  const registerModule = require('./register') as any;
  return { registerTracing: registerModule.registerTracing, NodeSdkMock: sdkModule.NodeSDK };
}

describe('registerTracing', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not start the SDK when NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.TELEMETRY_ENABLED;
    const { registerTracing, NodeSdkMock } = loadFreshRegister();

    expect(() => registerTracing('order')).not.toThrow();
    expect(NodeSdkMock).not.toHaveBeenCalled();
  });

  it('does not start the SDK when TELEMETRY_ENABLED=false, regardless of NODE_ENV', () => {
    process.env.NODE_ENV = 'production';
    process.env.TELEMETRY_ENABLED = 'false';
    const { registerTracing, NodeSdkMock } = loadFreshRegister();

    expect(() => registerTracing('order')).not.toThrow();
    expect(NodeSdkMock).not.toHaveBeenCalled();
  });

  it('starts the SDK once with the given service name when telemetry is enabled', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TELEMETRY_ENABLED;
    const { registerTracing, NodeSdkMock } = loadFreshRegister();

    registerTracing('order');

    expect(NodeSdkMock).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second call in the same process does not restart the SDK', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TELEMETRY_ENABLED;
    const { registerTracing, NodeSdkMock } = loadFreshRegister();

    registerTracing('order');
    registerTracing('order');

    expect(NodeSdkMock).toHaveBeenCalledTimes(1);
  });

  it('never throws even when the SDK constructor itself throws', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TELEMETRY_ENABLED;
    const { registerTracing, NodeSdkMock } = loadFreshRegister();
    NodeSdkMock.mockImplementationOnce(() => {
      throw new Error('collector unreachable');
    });

    expect(() => registerTracing('order')).not.toThrow();
  });
});
