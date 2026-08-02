/**
 * Pure label logic for the nap widget's two states.
 *
 * Kept out of `NapWidget.tsx` because `vitest.config.ts` only matches
 * `.test.ts`: anything living in a component file is untestable by convention
 * here (same reason `src/features/activity/queuedMarker.ts` exists).
 *
 * The visible text and the accessible name are built together, in one function,
 * on purpose. The widget tree is rasterised to a bitmap before Android ever
 * sees it (`RNWidget.java`: `drawViewToBitmap`, then `setImageViewUri`), so
 * TalkBack can read NOTHING a `TextWidget` draws; the root
 * `contentDescription` is the only string that reaches it. Returning both from
 * one call is what stops the tile naming a child that the screen reader still
 * announces as an anonymous "Start nap".
 *
 * The two differ in exactly one way, the name's length (see `NAME_CAP`), and
 * they must never differ in any other. That is the reason they stay one call
 * rather than becoming two functions the widget composes itself.
 */

export interface NapLabels {
  /** the tile's own line: the button label when idle, the header when napping */
  text: string;
  /** the root contentDescription, the ONLY string a screen reader can reach */
  accessibilityLabel: string;
}

/**
 * Longest name drawn on the tile before it is cut, in characters.
 *
 * A backstop against a pathological name, not a promise of a single line: the
 * usable width depends on how far the user resized the widget and glyphs are
 * not monospaced, so no character count can guarantee a fit. What it does
 * guarantee is a bound. `RootWidget.java` measures the tree with
 * `MeasureSpec.EXACTLY` at the real widget size, so an over-wide line wraps and
 * the overflow is clipped out of the bitmap; on the napping branch the row that
 * gets pushed out is the 26sp elapsed time, which is the whole point of the
 * tile. An unnamed cap would let one long name cost the user the figure they
 * opened the widget for.
 *
 * Ten is high enough that essentially every real first name passes through
 * untouched (the cut is an edge case, not the common path) and low enough to
 * bound the napping line at 21 characters.
 *
 * The cut happens HERE and not with `truncate="END"` on the `TextWidget`, which
 * the library does support: that would ellipsise the whole line, so
 * "Alexander · Start nap" becomes "Alexander · Star…" and the tile stops saying
 * what tapping it does. Cutting the name keeps the verb.
 */
const NAME_CAP = 10;

/**
 * The tile's strings for one state, naming the child only when that says
 * something.
 *
 * Silent below two children, matching `attributionFor` on the queue screen:
 * with one child the answer is never in doubt. Silent too when the name is
 * blank, which `buildWidgetSnapshot` writes whenever no child matches the
 * selected id, and when the count is missing, which is what a snapshot written
 * before the field existed yields.
 *
 * The name is folded into the existing line rather than given one of its own:
 * the nap widget is one cell tall (`minHeight: "40dp"`) and the napping branch
 * already stacks three lines inside it, so a fourth would clip at minimum size.
 */
export function napLabels(opts: {
  childName: string | undefined;
  childCount: number | undefined;
  napping: boolean;
}): NapLabels {
  const named = (opts.childCount ?? 1) >= 2 ? (opts.childName ?? '') : '';
  if (!named) {
    return opts.napping
      ? { text: '● Napping', accessibilityLabel: 'Stop nap' }
      : { text: 'Start nap', accessibilityLabel: 'Start nap' };
  }
  // Only the drawn name is capped. A `contentDescription` has no width, so
  // there is nothing to save by cutting it and the screen-reader user gets the
  // real name.
  //
  // The cut can land on a space ("Mary Jane Elizabeth" slices to "Mary Jane "),
  // so the tail is trimmed before the ellipsis is appended. That can leave the
  // drawn name shorter than the cap, which is fine: the cap is a bound, not a
  // target. This trims the SLICE and not the raw name on purpose. A blank or
  // padded name is a separate, pre-existing exposure shared with `StatusWidget`,
  // and fixing one of those two sites would be worse than fixing neither.
  const shown = named.length > NAME_CAP ? `${named.slice(0, NAME_CAP).replace(/\s+$/, '')}…` : named;
  // "Ada, stop nap" mirrors the visible line with the separator spoken as a
  // pause, and follows the app's own "${child.first}, switch child" idiom.
  return opts.napping
    ? { text: `● ${shown} napping`, accessibilityLabel: `${named}, stop nap` }
    : { text: `${shown} · Start nap`, accessibilityLabel: `${named}, start nap` };
}
