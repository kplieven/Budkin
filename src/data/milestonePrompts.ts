/**
 * Persisted on-device record of which milestone catch-up prompts the user has
 * answered, per child. Backed by AsyncStorage, mirroring src/data/prefs.ts and
 * src/data/timers.ts. Shape: { [childId]: string[] } where each string is a
 * milestone catalog key the user has answered (Yes, Not yet, or dismissed).
 * This is what makes the nudge one-and-done across app restarts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'budkin.milestonePrompts.v1';

export async function loadMilestonePrompts(): Promise<Record<string, string[]>> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return {};
    return JSON.parse(s) as Record<string, string[]>;
  } catch (e) {
    console.warn('[milestonePrompts] loadMilestonePrompts failed:', e);
    return {};
  }
}

export async function saveMilestonePrompts(map: Record<string, string[]>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('[milestonePrompts] saveMilestonePrompts failed:', e);
  }
}
