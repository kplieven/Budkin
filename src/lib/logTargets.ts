/**
 * Who an open log sheet is logging for.
 *
 * The draft used to have no opinion: `save()` read the GLOBAL selection at save
 * time, so anything that moved the selection under an open sheet re-aimed the
 * draft (a warm notification tap for a sibling does exactly that, and the sheet
 * is a root overlay that survives the navigation). The sheet now carries its own
 * target list, seeded when it opens, and these are the pure decisions built on
 * it: `.tsx` has no test harness here (vitest matches `src/**\/*.test.ts`), so
 * the logic lives in a module the sheet and the store both call. Same split as
 * `logDeepLink.ts`: pure decision, thin caller.
 */

import type { Child } from '@/types/models';

/**
 * The children a save will file against.
 *
 * An EMPTY sheet list is not "nobody", it is "never seeded", and it has to keep
 * meaning whatever the pre-sheet-target rule picked. `save()` passes its own
 * fallback (the edited entry's child, else the source timer's, else the
 * selection), so the old binding survives untouched underneath.
 */
export function sheetTargetIds(sheetChildIds: string[], fallbackChildId: string): string[] {
  return sheetChildIds.length > 0 ? sheetChildIds : [fallbackChildId];
}

/**
 * The child the time-entry anchor chips ("since last feed", "since they woke")
 * are scoped to, or undefined when there is no single right answer.
 *
 * Several targets yields undefined on purpose. This is the one surface where an
 * unscoped read PERSISTS a wrong value rather than only displaying one: tapping
 * a suggestion chip writes that timestamp onto the entry, so offering one twin's
 * last feed as the other's would save it as fact. With nothing safe to offer,
 * the chips are suppressed.
 */
export function anchorChildId(sheetChildIds: string[], fallbackChildId: string): string | undefined {
  const ids = sheetTargetIds(sheetChildIds, fallbackChildId);
  return ids.length === 1 ? ids[0] : undefined;
}

/**
 * The children the picker may offer. Expecting children are excluded: their
 * `birth` is a due date, not a real one, and the rest of the app treats logging
 * against them as unreachable (`resolveLogDeepLink` refuses such a link
 * outright), so listing them here would open a new entrance to it.
 *
 * Returns a fresh array, so call it in a render body over a raw-selected
 * `children`, never inside a `useAppStore` selector (zustand v5).
 */
export function eligibleTargetChildren(children: Child[]): Child[] {
  return children.filter((c) => !c.expected);
}

/**
 * The names behind the sheet header's "for ..." line: "Mira", "Mira and Ivo",
 * "Mira, Ivo and Ada". Ordered by the TARGET list rather than the roster, so the
 * line reads back the taps that built it.
 *
 * Ids that name nobody are dropped, and an empty result means the caller should
 * hide the line entirely (which is what it already did with no child at all).
 */
export function targetChildrenLabel(children: Child[], ids: string[]): string {
  const names = ids
    .map((id) => children.find((c) => c.id === id)?.first)
    .filter((n): n is string => !!n);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
