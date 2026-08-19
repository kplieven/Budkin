/**
 * Pure label logic for the nap widget's two states.
 *
 * The visible text and the accessible name are built together on purpose. The widget
 * tree is rasterised to a bitmap before Android ever sees it (`RNWidget.java`:
 * `drawViewToBitmap`, then `setImageViewUri`), so TalkBack can read nothing a
 * `TextWidget` draws and the root `contentDescription` is the only string that reaches
 * it. One call returning both is what stops the tile naming a child that the screen
 * reader still announces as an anonymous "Start nap". They differ in exactly one way,
 * the name's length, and must never differ in any other.
 */

export interface NapLabels {
  /** the tile's own line: the button label when idle, the header when napping */
  text: string;
  /** the root contentDescription, the ONLY string a screen reader can reach */
  accessibilityLabel: string;
}

/**
 * A backstop against a pathological name, not a promise of a single line: usable width
 * depends on how far the user resized the widget and glyphs are not monospaced.
 * `RootWidget.java` measures with `MeasureSpec.EXACTLY` at the real widget size, so an
 * over-wide line wraps and the overflow is clipped out of the bitmap, and on the napping
 * branch the row pushed out is the 26sp elapsed time.
 *
 * Cut here rather than with the `TextWidget`'s own `truncate="END"`, which ellipsises the
 * whole line: "Alexander · Start nap" would become "Alexander · Star…" and the tile would
 * stop saying what tapping it does.
 */
const NAME_CAP = 10;

/**
 * Silent below two children, matching `attributionFor` on the queue screen, and silent
 * when the name is blank or the count is missing, which is what a snapshot written before
 * the field existed yields.
 *
 * The name folds into the existing line rather than taking one of its own: the nap widget
 * is one cell tall and the napping branch already stacks three lines inside it.
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
  // Only the drawn name is capped, since a contentDescription has no width. The cut can
  // land on a space ("Mary Jane Elizabeth" slices to "Mary Jane "), so the tail is
  // trimmed before the ellipsis.
  const shown = named.length > NAME_CAP ? `${named.slice(0, NAME_CAP).replace(/\s+$/, '')}…` : named;
  return opts.napping
    ? { text: `● ${shown} napping`, accessibilityLabel: `${named}, stop nap` }
    : { text: `${shown} · Start nap`, accessibilityLabel: `${named}, start nap` };
}
