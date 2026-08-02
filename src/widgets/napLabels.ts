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
 */

export interface NapLabels {
  /** the tile's own line: the button label when idle, the header when napping */
  text: string;
  /** the root contentDescription, the ONLY string a screen reader can reach */
  accessibilityLabel: string;
}

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
  // "Ada, stop nap" mirrors the visible line with the separator spoken as a
  // pause, and follows the app's own "${child.first}, switch child" idiom.
  return opts.napping
    ? { text: `● ${named} napping`, accessibilityLabel: `${named}, stop nap` }
    : { text: `${named} · Start nap`, accessibilityLabel: `${named}, start nap` };
}
