import { CircuitBreakerRegistry } from '@gateway/proxy/circuit-breaker.registry';
import type { ConfigService } from '@nestjs/config';

function configStub(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    CB_ENABLED: true,
    CB_ERROR_THRESHOLD_PERCENT: 1,
    CB_RESET_TIMEOUT_MS: 50,
    CB_ROLLING_WINDOW_MS: 10_000,
    CB_VOLUME_THRESHOLD: 2,
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('CircuitBreakerRegistry', () => {
  it('opens after the volume+error threshold and stops invoking the action', async () => {
    const registry = new CircuitBreakerRegistry(configStub());
    const action = jest.fn().mockRejectedValue(new Error('downstream down'));

    await expect(registry.run('catalog', action)).rejects.toThrow('downstream down');
    await expect(registry.run('catalog', action)).rejects.toThrow('downstream down');
    expect(action).toHaveBeenCalledTimes(2);

    await expect(registry.run('catalog', action)).rejects.toMatchObject({ code: 'EOPENBREAKER' });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('half-opens after the reset timeout and closes once a probe succeeds', async () => {
    const registry = new CircuitBreakerRegistry(configStub());
    const failing = jest.fn().mockRejectedValue(new Error('downstream down'));

    await expect(registry.run('order', failing)).rejects.toThrow();
    await expect(registry.run('order', failing)).rejects.toThrow();
    await expect(registry.run('order', failing)).rejects.toMatchObject({ code: 'EOPENBREAKER' });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const recovered = jest.fn().mockResolvedValue('ok');
    await expect(registry.run('order', recovered)).resolves.toBe('ok');
    expect(recovered).toHaveBeenCalledTimes(1);

    const nextCall = jest.fn().mockRejectedValue(new Error('downstream down again'));
    await expect(registry.run('order', nextCall)).rejects.toThrow('downstream down again');
    expect(nextCall).toHaveBeenCalledTimes(1);
  });

  it('isolates breakers per service — a dead one never trips another', async () => {
    const registry = new CircuitBreakerRegistry(configStub());
    const failing = jest.fn().mockRejectedValue(new Error('down'));

    await expect(registry.run('catalog', failing)).rejects.toThrow();
    await expect(registry.run('catalog', failing)).rejects.toThrow();
    await expect(registry.run('catalog', failing)).rejects.toMatchObject({ code: 'EOPENBREAKER' });

    const healthy = jest.fn().mockResolvedValue('ok');
    await expect(registry.run('search', healthy)).resolves.toBe('ok');
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('is a pure pass-through when disabled — action always runs, breaker never opens', async () => {
    const registry = new CircuitBreakerRegistry(configStub({ CB_ENABLED: false }));
    const failing = jest.fn().mockRejectedValue(new Error('down'));

    for (let i = 0; i < 10; i += 1) {
      await expect(registry.run('catalog', failing)).rejects.toThrow('down');
    }
    expect(failing).toHaveBeenCalledTimes(10);
  });

  it('tolerates the raw env string "false" for CB_ENABLED (un-transformed ConfigService read)', async () => {
    const registry = new CircuitBreakerRegistry(configStub({ CB_ENABLED: 'false' }));
    const action = jest.fn().mockResolvedValue('ok');

    await expect(registry.run('catalog', action)).resolves.toBe('ok');
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('shuts every cached breaker down on application shutdown without throwing', async () => {
    const registry = new CircuitBreakerRegistry(configStub());
    await expect(registry.run('catalog', () => Promise.resolve('ok'))).resolves.toBe('ok');
    await expect(registry.run('order', () => Promise.resolve('ok'))).resolves.toBe('ok');

    expect(() => registry.onApplicationShutdown()).not.toThrow();
  });
});
