/**
 * Whose record a row or card is showing, in every form a surface needs.
 *
 * Kept out of the `.tsx` because `vitest.config.ts` only matches `.test.ts`:
 * anything living in a component file is untestable by convention here (same
 * reason `src/features/queue/queueView.ts` backs the queue screen and
 * `queuedMarker.ts` next door backs the timeline's queued marker).
 *
 * Three surfaces name a child, and they must name the same one the same way.
 * The two running-timer cards (`src/features/dashboard/DashboardContent.tsx`
 * and `src/app/(tabs)/(home)/timers.tsx`) have fully duplicated markup and no
 * shared component, and between them six strings; History's timeline rows are
 * the third (see `TimelineEntry`). Every form comes out of ONE call for the same
 * reason `napLabels` builds both of its at once: they differ in exactly one
 * thing, how the name is attached, and they must never differ in any other.
 *
 * The cards attach it as a text suffix and History draws a tinted chip, so the
 * drawn forms genuinely do differ; `spoken` does not, and that is the point. A
 * chip is drawn, so it must also be announced (`timelineRowLabel` states that
 * contract for the timeline), and a caller that had to build its own spoken
 * string from `name` would be free to forget.
 *
 * The separator in the text forms is where drawn and spoken differ because a
 * screen reader announcing "middle dot" is noise. A comma is the pause the drawn
 * dot stands for, and it matches the app's own "${child.first}, switch child"
 * idiom.
 *
 * The rule itself is `attributionFor`'s and is not restated here: silent below
 * two children, silent for a child the device no longer has.
 */

import { attributionFor } from '@/features/queue/queueView';

export interface ChildAttribution {
  /** The child's first name, for a surface that draws its own element (History's
   *  chip). Null when there is nothing worth saying, which is the same condition
   *  as the two string forms being empty. */
  name: string | null;
  /** The child's avatar tint, to draw that element in. Null exactly when `name`
   *  is, and also null for a child list that carries no tint (the widget
   *  snapshots pass `{ id, first }` alone), which a caller renders in a neutral
   *  colour rather than treating as "no attribution". */
  color: string | null;
  /** appended to a card's own line: " · Mara", or "" when there is nothing to say */
  drawn: string;
  /** appended to an accessibilityLabel: ", Mara", or "" */
  spoken: string;
}

/** Silence, shared so every "nothing to say" answer is the same object shape.
 *  Not exported: callers test `name`, not identity. */
const SILENT: ChildAttribution = { name: null, color: null, drawn: '', spoken: '' };

/**
 * The attribution for one record, from ITS `childId` and nothing else.
 *
 * `childId` is optional because `Timer.childId` is: `budkin.timers.v1` holds
 * whole payloads that are cast rather than validated, so a timer persisted
 * before the stamping existed can still arrive without an owner. That resolves
 * to silence, which is the right answer. There is deliberately no fallback to
 * the selected child: naming a record after whoever happens to be selected is
 * the misattribution `timerBelongsTo` stopped making, and on History it would be
 * worse still, since the whole point of the household view is that the selected
 * child is NOT the row's owner.
 */
export function childAttribution(
  childId: string | undefined,
  children: { id: string; first: string; color?: string }[],
): ChildAttribution {
  const who = attributionFor(childId, children);
  if (!who) return SILENT;
  return {
    name: who,
    color: children.find((c) => c.id === childId)?.color ?? null,
    drawn: ` · ${who}`,
    spoken: `, ${who}`,
  };
}
