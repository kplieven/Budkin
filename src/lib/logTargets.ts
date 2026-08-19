/**
 * Who an open log sheet is logging for.
 *
 * The sheet carries its own target list, seeded when it opens, rather than reading the
 * global selection at save time: anything that moved the selection under an open sheet
 * used to re-aim the draft, and a warm notification tap for a sibling does exactly that,
 * since the sheet is a root overlay that survives the navigation.
 */

import type { Child } from '@/types/models';

/** An empty sheet list is not "nobody", it is "never seeded", so it defers to the
 *  caller's fallback: the edited entry's child, else the timer's, else the selection. */
export function sheetTargetIds(sheetChildIds: string[], fallbackChildId: string): string[] {
  return sheetChildIds.length > 0 ? sheetChildIds : [fallbackChildId];
}

/**
 * Undefined when several children are targeted. This is the one surface where an unscoped
 * read persists a wrong value rather than only displaying one: tapping a suggestion chip
 * writes that timestamp onto the entry, so offering one twin's last feed as the other's
 * would save it as fact.
 */
export function anchorChildId(sheetChildIds: string[], fallbackChildId: string): string | undefined {
  const ids = sheetTargetIds(sheetChildIds, fallbackChildId);
  return ids.length === 1 ? ids[0] : undefined;
}

/**
 * Expecting children are excluded: their `birth` is a due date, not a real one. Returns a
 * fresh array, so call it in a render body, never inside a `useAppStore` selector.
 */
export function eligibleTargetChildren(children: Child[]): Child[] {
  return children.filter((c) => !c.expected);
}

/** The single-id form, for guarding a write. One rule, so the picker's chips and the
 *  store's toggle cannot drift into offering a target nothing can take back off. */
export function isEligibleTarget(children: Child[], id: string): boolean {
  const child = children.find((c) => c.id === id);
  return !!child && !child.expected;
}

/**
 * "Mira", "Mira and Ivo", "Mira, Ivo and Ada". Ordered by the target list rather than the
 * roster, so the line reads back the taps that built it. Empty means hide the line.
 */
export function targetChildrenLabel(children: Child[], ids: string[]): string {
  const names = ids
    .map((id) => children.find((c) => c.id === id)?.first)
    .filter((n): n is string => !!n);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
