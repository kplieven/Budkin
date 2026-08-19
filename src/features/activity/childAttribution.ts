/**
 * Whose record a row or card is showing, in every form a surface needs.
 *
 * Three surfaces name a child (the two running-timer cards, which have fully duplicated
 * markup and no shared component, and History's timeline rows) and they must name the
 * same one the same way. The cards attach a text suffix and History draws a tinted chip,
 * so the drawn forms genuinely differ; `spoken` does not, and that is the point. A chip
 * is drawn, so it must also be announced, and a caller building its own spoken string
 * from `name` would be free to forget.
 *
 * The separator differs between drawn and spoken because a screen reader announcing
 * "middle dot" is noise. A comma is the pause the drawn dot stands for.
 */

import { attributionFor } from '@/features/queue/queueView';

export interface ChildAttribution {
  /** First name, for a surface that draws its own element. Null when there is nothing
   *  worth saying, the same condition as the string forms being empty. */
  name: string | null;
  /** Null exactly when `name` is, and also null for a child list carrying no tint
   *  (widget snapshots pass `{ id, first }` alone), which a caller renders neutral. */
  color: string | null;
  /** appended to a card's own line: " · Mara", or "" when there is nothing to say */
  drawn: string;
  /** appended to an accessibilityLabel: ", Mara", or "" */
  spoken: string;
}

const SILENT: ChildAttribution = { name: null, color: null, drawn: '', spoken: '' };

/**
 * From the record's own `childId` and nothing else. That is optional because
 * `Timer.childId` is: `budkin.timers.v1` holds whole payloads that are cast rather than
 * validated, so a timer persisted before the stamping existed can arrive without an
 * owner, and resolves to silence.
 *
 * There is deliberately no fallback to the selected child. On History it would be worse
 * than useless, since the whole point of the household view is that the selected child is
 * not the row's owner.
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
