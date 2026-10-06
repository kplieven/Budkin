import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadPrefs, savePrefs } from '@/data/prefs';
import { dismissUnitsNotice, initUnitsNotice, useUnitsNotice } from '@/features/unitsNotice/unitsNotice';

// In-memory stand-in for the native AsyncStorage module, so the ack round-trips
// through the real prefs file.
const mem = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      mem.store.set(k, v);
    }),
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mem.store.clear();
  useUnitsNotice.setState({ visible: false });
});

describe('label-only units notice', () => {
  it('shows only for a stored imperial choice without the ack', () => {
    initUnitsNotice({ unitSystem: 'metric' });
    expect(useUnitsNotice.getState().visible).toBe(false);
    initUnitsNotice({ unitSystem: 'imperial', unitsLabelOnlyAck: true });
    expect(useUnitsNotice.getState().visible).toBe(false);
    initUnitsNotice({ unitSystem: 'imperial' });
    expect(useUnitsNotice.getState().visible).toBe(true);
  });

  it('dismissing hides it and persists the ack next to the existing prefs', async () => {
    await savePrefs({ unitSystem: 'imperial' });
    initUnitsNotice(await loadPrefs());
    dismissUnitsNotice();
    expect(useUnitsNotice.getState().visible).toBe(false);
    await flush();

    const stored = await loadPrefs();
    expect(stored).toEqual({ unitSystem: 'imperial', unitsLabelOnlyAck: true });
    // The next launch stays quiet.
    initUnitsNotice(stored);
    expect(useUnitsNotice.getState().visible).toBe(false);
  });
});
