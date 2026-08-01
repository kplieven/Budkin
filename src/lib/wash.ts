/**
 * The two kinds of bath Budkin tracks: a `full` bath in the tub, and a `quick`
 * wash of face, hands and bottom at the changing table.
 *
 * These were called `big` and `small` until 2026-08. The old values persist in
 * two places Budkin does not control: entry chunks already written to
 * AsyncStorage (`src/data/entityStore.ts`), and tags on the user's Baby Buddy
 * server. Both read boundaries must therefore run stored values through
 * `normalizeWash`.
 *
 * That is not cosmetic. `washDueState` compares against `'quick'`, so a device
 * full of `'small'` entries would report every bath as a full bath and a full
 * bath would never come due. The failure is silent: the feature just stops.
 */
export type WashKind = 'quick' | 'full';

/**
 * Coerce any persisted or server-supplied value to a `WashKind`. `full` and the
 * legacy `big` mean full; everything else means quick, preserving the historical
 * rule where anything not explicitly big read as small.
 */
export function normalizeWash(raw: unknown): WashKind {
  return raw === 'full' || raw === 'big' ? 'full' : 'quick';
}
