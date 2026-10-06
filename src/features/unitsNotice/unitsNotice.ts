/**
 * One-time notice for users who had imperial selected before the units setting became
 * label-only (1.5.1). Until then Budkin converted, so what those users
 * logged in Budkin sits on the server in metric and now reads with an imperial label.
 *
 * Shown once: dismissing it, or choosing units in Settings, records the ack, and a user
 * who never had imperial selected never sees it.
 *
 * TEMPORARY. To remove once that release has been out a while, delete this folder and
 * every hit of `grep -rn "UNITS NOTICE\|UnitsNotice\|unitsLabelOnlyAck" src`:
 *   - the import and `<UnitsNotice />` mounts in src/app/(tabs)/(home)/index.tsx
 *   - the import and hydrate/setUnitSystem lines in src/store/useAppStore.ts (keep the
 *     `savePrefs({ unitSystem })` itself)
 *   - `unitsLabelOnlyAck` in src/data/prefs.ts; an ack already stored is harmless
 */

import { create } from 'zustand';

import { savePrefs, type Prefs } from '@/data/prefs';

export const useUnitsNotice = create<{ visible: boolean }>(() => ({ visible: false }));

/** Called from hydrate with the prefs as stored before this session touched them. */
export function initUnitsNotice(prefs: Partial<Prefs>): void {
  if (prefs.unitSystem === 'imperial' && !prefs.unitsLabelOnlyAck) useUnitsNotice.setState({ visible: true });
}

/** Hides without persisting: for a caller that saves the ack in its own prefs write. */
export function hideUnitsNotice(): void {
  useUnitsNotice.setState({ visible: false });
}

export function dismissUnitsNotice(): void {
  hideUnitsNotice();
  void savePrefs({ unitsLabelOnlyAck: true });
}
