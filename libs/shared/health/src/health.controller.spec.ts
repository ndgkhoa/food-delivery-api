import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns a 200-worthy ok status body', () => {
    const controller = new HealthController();

    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
