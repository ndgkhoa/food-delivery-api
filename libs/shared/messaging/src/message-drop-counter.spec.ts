import { MessageDropCounter } from './message-drop-counter';

describe('MessageDropCounter', () => {
  it('starts every topic/reason pair at zero', () => {
    const counter = new MessageDropCounter();

    expect(counter.get('order.events', 'undecodable')).toBe(0);
    expect(counter.total()).toBe(0);
    expect(counter.snapshot()).toEqual({});
  });

  it('accumulates counts per topic + reason independently', () => {
    const counter = new MessageDropCounter();

    counter.record('order.events', 'undecodable');
    counter.record('order.events', 'undecodable');
    counter.record('order.events', 'handler-exhausted');
    counter.record('inventory.replies', 'undecodable');

    expect(counter.get('order.events', 'undecodable')).toBe(2);
    expect(counter.get('order.events', 'handler-exhausted')).toBe(1);
    expect(counter.get('inventory.replies', 'undecodable')).toBe(1);
  });

  it('sums every recorded drop across topics and reasons in total()', () => {
    const counter = new MessageDropCounter();

    counter.record('order.events', 'undecodable');
    counter.record('order.events', 'handler-exhausted');
    counter.record('inventory.replies', 'undecodable');

    expect(counter.total()).toBe(3);
  });

  it('snapshots the internal counts keyed by "topic::reason"', () => {
    const counter = new MessageDropCounter();

    counter.record('order.events', 'undecodable');
    counter.record('inventory.replies', 'handler-exhausted');

    expect(counter.snapshot()).toEqual({
      'order.events::undecodable': 1,
      'inventory.replies::handler-exhausted': 1,
    });
  });
});
