import { describe, expect, it } from 'vitest';

import type { Child } from '@/types/models';
import { buildWidgetSnapshot } from '@/widgets/snapshot';

const child: Child = { id: 'c1', first: 'Ada', last: 'L', birth: 0, color: '#ffffff' };
const baseState = { children: [child], selectedChildId: 'c1', entries: [], timers: [] };

describe('buildWidgetSnapshot child + queue fields', () => {
  it('passes through selectedChildId', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: { mode: 'server', serverUrl: 'http://x', token: 't' } });
    expect(s.selectedChildId).toBe('c1');
  });

  it('canQueueNap is true for a real connection', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: { mode: 'server', serverUrl: 'http://x', token: 't' } });
    expect(s.canQueueNap).toBe(true);
  });

  it('canQueueNap is false in demo mode', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: { mode: 'local' } });
    expect(s.canQueueNap).toBe(false);
  });

  it('canQueueNap is false with no connection', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: null });
    expect(s.canQueueNap).toBe(false);
  });
});
