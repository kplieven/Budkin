import { describe, expect, it } from 'vitest';

import { nextAfterConnect } from '@/features/setup/routing';

describe('nextAfterConnect', () => {
  it('continues into the add-baby step when the server has no children', () => {
    expect(nextAfterConnect(0)).toBe('/setup/baby');
  });

  it('finishes straight into the app when the server already has a child', () => {
    expect(nextAfterConnect(1)).toBe('/(tabs)');
  });

  it('finishes straight into the app for several children', () => {
    expect(nextAfterConnect(4)).toBe('/(tabs)');
  });
});
