/**
 * Persisted running timers, backed by AsyncStorage. A timer is a stopwatch not yet
 * committed as an entry, and this on-device copy is what brings running timers back
 * after the app is closed and reopened.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Timer } from '@/types/models';

const KEY = 'budkin.timers.v1';

export async function loadTimers(): Promise<Timer[]> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return [];
    // Older builds persisted a `stagedEnd` field; strip it so dead data does not
    // round-trip forever.
    const parsed = JSON.parse(s) as (Timer & { stagedEnd?: number })[];
    return parsed.map(({ stagedEnd: _stagedEnd, ...t }) => t);
  } catch (e) {
    console.warn('[timers] loadTimers failed:', e);
    return [];
  }
}

export async function saveTimers(timers: Timer[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(timers));
  } catch (e) {
    console.warn('[timers] saveTimers failed:', e);
  }
}

export async function clearTimers(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
