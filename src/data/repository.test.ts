import { describe, expect, it, vi } from 'vitest';

import { entryTimestamp } from '@/types/models';

import { loadInsightsHistory, loadProfileFromServer } from './repository';

const DAY = 86400000;

// Mock the client so no network is touched.
const listSleep = vi.fn();
const listFeedings = vi.fn();
const listChanges = vi.fn();
const getProfile = vi.fn();
vi.mock('@/api/client', () => ({
  BabybuddyClient: vi.fn().mockImplementation(() => ({ listSleep, listFeedings, listChanges, getProfile })),
  normalizeServerUrl: (s: string) => s,
}));

const sleepEntry = (start: number) => ({ id: `s-${start}`, type: 'sleep', childId: 'c1', start, end: start + 3600000, nap: false, tags: [] });

describe('loadInsightsHistory', () => {
  it('pages until entries fall before the cutoff and trims them', async () => {
    const now = Date.now();
    // page 1 = 100 recent, page 2 = 100 that cross the cutoff
    listSleep.mockReset();
    listSleep
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => sleepEntry(now - i * 3600000)))
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => sleepEntry(now - (100 + i) * DAY)));
    listFeedings.mockResolvedValue([]);
    listChanges.mockResolvedValue([]);

    const out = await loadInsightsHistory({ mode: 'server', serverUrl: 'x', token: 'y' }, 'c1', now - 90 * DAY);
    expect(out.every((e) => entryTimestamp(e) >= now - 90 * DAY)).toBe(true);
    expect(listSleep).toHaveBeenCalledWith('c1', 100, 0);
    expect(listSleep).toHaveBeenCalledWith('c1', 100, 100);
  });

  it('returns [] in demo mode without calling the client', async () => {
    listSleep.mockClear();
    const out = await loadInsightsHistory({ mode: 'local' }, 'c1', 0);
    expect(out).toEqual([]);
    expect(listSleep).not.toHaveBeenCalled();
  });
});

describe('loadProfileFromServer', () => {
  it('returns null in demo mode without calling the client', async () => {
    getProfile.mockClear();
    const out = await loadProfileFromServer({ mode: 'local' });
    expect(out).toBeNull();
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('fetches the profile from the client for a real connection', async () => {
    getProfile.mockReset().mockResolvedValueOnce({ username: 'alex', timezone: 'UTC' });
    const out = await loadProfileFromServer({ mode: 'server', serverUrl: 'x', token: 'y' });
    expect(out).toEqual({ username: 'alex', timezone: 'UTC' });
    expect(getProfile).toHaveBeenCalled();
  });

  it('propagates a client error (caller decides how to degrade)', async () => {
    getProfile.mockReset().mockRejectedValueOnce(new Error('500'));
    await expect(loadProfileFromServer({ mode: 'server', serverUrl: 'x', token: 'y' })).rejects.toThrow('500');
  });
});
