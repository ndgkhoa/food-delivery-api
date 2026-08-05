import type { Logger as LoggerType } from '@nestjs/common';

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));

interface FreshModules {
  registerTracing: (serviceName: string) => void;
  NodeSdkMock: jest.Mock;
  Logger: typeof LoggerType;
}

function loadFreshRegister(): FreshModules {
  jest.resetModules();
  // biome-ignore lint/suspicious/noExplicitAny: dynamic re-require of a mocked module for per-test isolation
  const sdkModule = require('@opentelemetry/sdk-node') as any;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic re-require under jest.resetModules()
  const commonModule = require('@nestjs/common') as any;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic re-require under jest.resetModules()
  const registerModule = require('./register') as any;
  return {
    registerTracing: registerModule.registerTracing,
    NodeSdkMock: sdkModule.NodeSDK,
    Logger: commonModule.Logger,
  };
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

  it('logs a warning without throwing when the SDK start() promise rejects asynchronously', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TELEMETRY_ENABLED;
    const { registerTracing, NodeSdkMock, Logger } = loadFreshRegister();
    NodeSdkMock.mockImplementationOnce(() => ({
      start: jest.fn().mockRejectedValue(new Error('async start failed')),
      shutdown: jest.fn().mockResolvedValue(undefined),
    }));
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    expect(() => registerTracing('order')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('async start failed'));
    warnSpy.mockRestore();
  });

  it('logs a warning per target that fails to shut down when SIGTERM triggers cleanup', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TELEMETRY_ENABLED;
    const onceSpy = jest.spyOn(process, 'once');
    const { registerTracing, NodeSdkMock, Logger } = loadFreshRegister();
    NodeSdkMock.mockImplementationOnce(() => ({
      start: jest.fn(),
      shutdown: jest.fn().mockRejectedValue(new Error('collector unreachable')),
    }));

    registerTracing('order');

    const sigtermCall = onceSpy.mock.calls.find(([event]) => event === 'SIGTERM');
    expect(sigtermCall).toBeDefined();
    const handler = sigtermCall?.[1] as () => void;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    handler();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('tracing shutdown failed'));
    onceSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
