import { beforeEach, describe, expect, it, vi } from 'vitest';

import { backOr } from '@/lib/nav';

// Stand-in for the imperative router. `canGoBack` is what the helper branches on.
const nav = vi.hoisted(() => ({ canGoBack: false }));
vi.mock('expo-router', () => ({
  router: {
    canGoBack: vi.fn(() => nav.canGoBack),
    back: vi.fn(),
    replace: vi.fn(),
  },
}));

const { router } = await import('expo-router');

beforeEach(() => {
  nav.canGoBack = false;
  vi.mocked(router.back).mockClear();
  vi.mocked(router.replace).mockClear();
});

describe('backOr', () => {
  it('pops the stack when there is a screen to go back to', () => {
    nav.canGoBack = true;
    backOr();
    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('falls back to Home when the screen was opened directly', () => {
    backOr();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('falls back to the given route when the screen was opened directly', () => {
    backOr('/welcome');
    expect(router.replace).toHaveBeenCalledWith('/welcome');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('prefers the real stack over the fallback when both are possible', () => {
    nav.canGoBack = true;
    backOr('/welcome');
    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
