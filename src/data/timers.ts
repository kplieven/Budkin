/**
 * Persisted running timers, backed by AsyncStorage.
 *
 * Timers are a purely local concept (a stopwatch that hasn't been committed as
 * an entry yet): the Baby Buddy server has no matching record, so `loadFromServer`
 * always returns none. This on-device copy is the only thing that brings running
 * timers back after the app is closed and reopened.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Timer } from '@/types/models';

const KEY = 'babybuddy.timers.v1';

export async function loadTimers(): Promise<Timer[]> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return [];
    // Older builds persisted a `stagedEnd` field (the removed "Ended earlier?"
    // staged-end model). Strip it so it doesn't linger as dead data — nothing
    // reads it anymore, but leaving it round-tripping forever is just noise.
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
