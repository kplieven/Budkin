/**
 * The two kinds of bath Budkin tracks: a `full` bath in the tub, and a `quick` wash
 * of face, hands and bottom at the changing table.
 *
 * These were called `big` and `small` until 2026-08. The old values persist in two
 * places Budkin does not control: entry chunks already written to AsyncStorage, and
 * tags on the user's Baby Buddy server. Both read boundaries must run stored values
 * through `normalizeWash`. `washDueState` compares against `'quick'`, so a device
 * full of `'small'` entries reports every bath as a full bath and a full bath never
 * comes due. The failure is silent: the feature just stops.
 */
export type WashKind = 'quick' | 'full';

/** `full` and the legacy `big` mean full; everything else means quick. */
export function normalizeWash(raw: unknown): WashKind {
  return raw === 'full' || raw === 'big' ? 'full' : 'quick';
}
