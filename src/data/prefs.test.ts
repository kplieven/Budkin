import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadPrefs, savePrefs } from '@/data/prefs';

// In-memory stand-in for the native AsyncStorage module.
const mem = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      mem.store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      mem.store.delete(k);
    }),
  },
}));

beforeEach(() => {
  mem.store.clear();
});

describe('prefs persistence', () => {
  it('returns {} when nothing is saved', async () => {
    expect(await loadPrefs()).toEqual({});
  });

  it('round-trips a saved theme preference', async () => {
    await savePrefs({ themeMode: 'light' });
    expect(await loadPrefs()).toEqual({ themeMode: 'light' });
  });

  it('round-trips a saved units preference', async () => {
    await savePrefs({ unitSystem: 'imperial' });
    expect(await loadPrefs()).toEqual({ unitSystem: 'imperial' });
  });

  it('a partial save of unitSystem does NOT clobber a previously saved themeMode', async () => {
    await savePrefs({ themeMode: 'light' });
    await savePrefs({ unitSystem: 'imperial' });
    expect(await loadPrefs()).toEqual({ themeMode: 'light', unitSystem: 'imperial' });
  });

  it('a partial save of themeMode does NOT clobber a previously saved unitSystem', async () => {
    await savePrefs({ unitSystem: 'imperial' });
    await savePrefs({ themeMode: 'dark' });
    expect(await loadPrefs()).toEqual({ unitSystem: 'imperial', themeMode: 'dark' });
  });

  it('round-trips a saved wash rhythm', async () => {
    await savePrefs({ smallWashesPerBig: 5 });
    expect(await loadPrefs()).toEqual({ smallWashesPerBig: 5 });
  });

  it('round-trips the low end of the wash-rhythm range', async () => {
    await savePrefs({ smallWashesPerBig: 1 });
    expect(await loadPrefs()).toEqual({ smallWashesPerBig: 1 });
  });

  it('a partial save of the wash rhythm does NOT clobber the other prefs', async () => {
    await savePrefs({ themeMode: 'light', unitSystem: 'imperial' });
    await savePrefs({ smallWashesPerBig: 7 });
    expect(await loadPrefs()).toEqual({ themeMode: 'light', unitSystem: 'imperial', smallWashesPerBig: 7 });
  });

  it('round-trips a saved nap window', async () => {
    await savePrefs({ napWindowStartMin: 480, napWindowEndMin: 1200 });
    expect(await loadPrefs()).toEqual({ napWindowStartMin: 480, napWindowEndMin: 1200 });
  });

  it('round-trips a midnight boundary, which a truthy guard would drop', async () => {
    await savePrefs({ napWindowStartMin: 0, napWindowEndMin: 720 });
    expect(await loadPrefs()).toEqual({ napWindowStartMin: 0, napWindowEndMin: 720 });
  });

  it('a partial save of the nap window does NOT clobber the other prefs', async () => {
    await savePrefs({ themeMode: 'light', smallWashesPerBig: 4 });
    await savePrefs({ napWindowStartMin: 390, napWindowEndMin: 1110 });
    expect(await loadPrefs()).toEqual({
      themeMode: 'light',
      smallWashesPerBig: 4,
      napWindowStartMin: 390,
      napWindowEndMin: 1110,
    });
  });

  it('a later save overwrites the same field but keeps the others', async () => {
    await savePrefs({ themeMode: 'light', unitSystem: 'imperial' });
    await savePrefs({ unitSystem: 'metric' });
    expect(await loadPrefs()).toEqual({ themeMode: 'light', unitSystem: 'metric' });
  });

  it('returns {} instead of throwing on corrupt persisted JSON', async () => {
    mem.store.set('babybuddy.prefs.v1', '{not json');
    expect(await loadPrefs()).toEqual({});
  });

  it('tolerates a persisted file that predates a field (forward-compat Partial)', async () => {
    mem.store.set('babybuddy.prefs.v1', JSON.stringify({}));
    expect(await loadPrefs()).toEqual({});
  });
});
