/**
 * Whose timer a running-timer card is showing, in the two forms a card needs.
 *
 * Kept out of the `.tsx` because `vitest.config.ts` only matches `.test.ts`:
 * anything living in a component file is untestable by convention here (same
 * reason `src/features/queue/queueView.ts` backs the queue screen).
 *
 * There are TWO cards, `src/features/dashboard/DashboardContent.tsx` and
 * `src/app/(tabs)/(home)/timers.tsx`, with fully duplicated markup and no shared
 * component, and between them six strings that must name the same child the same
 * way. The drawn suffix and the spoken one come out of ONE call for the same
 * reason `napLabels` builds both at once: they differ in exactly one thing, the
 * separator, and they must never differ in any other.
 *
 * The separator is where they differ because a screen reader announcing "middle
 * dot" is noise. A comma is the pause the drawn dot stands for, and it matches
 * the app's own "${child.first}, switch child" idiom.
 *
 * The rule itself is `attributionFor`'s and is not restated here: silent below
 * two children, silent for a child the device no longer has.
 */

import { attributionFor } from '@/features/queue/queueView';

export interface TimerChildSuffix {
  /** appended to the card's own line: " · Mara", or "" when there is nothing to say */
  drawn: string;
  /** appended to an accessibilityLabel: ", Mara", or "" */
  spoken: string;
}

/**
 * The suffixes for one timer, from ITS `childId` and nothing else.
 *
 * `childId` is optional because `Timer.childId` is: `budkin.timers.v1` holds
 * whole payloads that are cast rather than validated, so a timer persisted
 * before the stamping existed can still arrive without an owner. That resolves
 * to no suffix, which is the right answer. There is deliberately no fallback to
 * the selected child: naming a timer after whoever happens to be selected is the
 * misattribution `timerBelongsTo` stopped making.
 */
export function timerChildSuffix(
  childId: string | undefined,
  children: { id: string; first: string }[],
): TimerChildSuffix {
  const who = attributionFor(childId, children);
  if (!who) return { drawn: '', spoken: '' };
  return { drawn: ` · ${who}`, spoken: `, ${who}` };
}
