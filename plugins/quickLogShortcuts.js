/**
 * The launcher shortcut set: what long-pressing the Budkin icon offers.
 *
 * Kept in its own module, apart from the plugin that installs it, for two
 * reasons. It lets `src/lib/quickLogShortcuts.test.ts` assert that every
 * shortcut still points at a real log sheet without importing
 * `expo/config-plugins` and the whole prebuild machinery into a vitest run. And
 * it keeps the one thing that can silently rot (the `<type>` segment of each
 * deep link) in a file with no build-time dependencies at all.
 *
 * CommonJS, not TypeScript, on purpose: `expo prebuild` loads a config plugin
 * through `@expo/require-utils`, which strips types but then resolves relative
 * imports as `.js`, so a `.ts` plugin that requires a sibling `.ts` module
 * fails with MODULE_NOT_FOUND. JSDoc gives us the types either way, since
 * `allowJs` is on.
 *
 * Three shortcuts, not more: they mirror the Status widget's buttons minus the
 * timer (see `src/widgets/StatusWidget.tsx`), which is the same editorial call
 * about what a parent logs one-handed. Android caps static shortcuts per
 * activity (`getMaxShortcutCountPerActivity`, in practice 4 to 5) and launchers
 * often show fewer, so three is comfortably inside the budget.
 */

/**
 * @typedef {object} QuickLogShortcut
 * @property {string} id
 *   `android:shortcutId`. Stable forever: Android keys a pinned shortcut by it,
 *   so reusing an id for a different action would silently repoint someone's
 *   pinned tile.
 * @property {'feeding' | 'diaper' | 'sleep'} activity
 *   The `<type>` segment of `budkin://log/<type>`. Must be in `ALL_ACTIVITIES`
 *   (`src/lib/activities.ts`) or the route resolves to nothing.
 * @property {string} shortLabel
 *   The launcher menu row. Android asks for 10 characters or fewer.
 * @property {string} longLabel
 *   Used where the launcher has room. Android asks for 25 or fewer.
 * @property {string} resourceName
 *   Base name for the generated `@string` and `@drawable` resources.
 * @property {string} plateColor
 *   The activity colour, drawn as a filled disc behind the glyph.
 * @property {string[]} glyph
 *   VectorDrawable `pathData`, drawn in white over the disc.
 */

/**
 * White on an activity-coloured plate, which is the app's own daylight
 * convention (`onActivity` in `src/theme/tokens.ts`). A bare glyph would have
 * to survive both a light and a dark launcher popup with no way to know which,
 * so the contrast is kept inside the icon instead of borrowed from whatever is
 * behind it.
 */
const GLYPH_COLOR = '#FFFFFF';

/**
 * The disc, filling the 24x24 viewport as two semicircular arcs. Drawn first,
 * under the glyph.
 */
const PLATE_PATH = 'M12,0 A12,12 0 1,1 12,24 A12,12 0 1,1 12,0 Z';

/**
 * How far the glyph is scaled down inside the disc. The glyphs were drawn to
 * fill their 24x24 box, so at 1.0 they would touch the rim; 0.62 keeps the
 * tallest of them (feeding, spanning y 2 to 22) well inside the circle.
 */
const GLYPH_SCALE = 0.62;

/**
 * The glyphs are transcribed from `activitySvg` in `src/widgets/widgetIcons.ts`
 * rather than imported from it. That module is TypeScript and returns SVG
 * markup for the runtime widget renderer, while this one has to be requirable
 * by plain node at prebuild time to emit an Android resource, so the two cannot
 * share a file. `src/lib/quickLogShortcuts.test.ts` compares them and fails if
 * they drift.
 *
 * @type {QuickLogShortcut[]}
 */
const QUICK_LOG_SHORTCUTS = [
  {
    id: 'log_feeding',
    activity: 'feeding',
    shortLabel: 'Feed',
    longLabel: 'Log a feed',
    resourceName: 'shortcut_log_feeding',
    plateColor: '#D9854B',
    glyph: [
      'M9 2h6a1.2 1.2 0 0 1 0 2.6H9A1.2 1.2 0 0 1 9 2z',
      'M10 4.4h4v2.2h-4z',
      'M8 8.5c0-1 .8-1.8 1.8-1.8h4.4c1 0 1.8 .8 1.8 1.8V19a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3z',
    ],
  },
  {
    id: 'log_diaper',
    activity: 'diaper',
    shortLabel: 'Diaper',
    longLabel: 'Log a diaper change',
    resourceName: 'shortcut_log_diaper',
    plateColor: '#3E9D80',
    glyph: ['M4.5 6.5h15c.6 0 1 .5 .9 1.1l-1.3 6.6A6.5 6.5 0 0 1 5.9 14.2L4.6 7.6c-.1-.6 .3-1.1 .9-1.1z'],
  },
  {
    id: 'log_sleep',
    activity: 'sleep',
    shortLabel: 'Sleep',
    longLabel: 'Log sleep',
    resourceName: 'shortcut_log_sleep',
    plateColor: '#7E6FC9',
    glyph: ['M12.5 3.2a7.5 7.5 0 1 0 8.3 11.4A6 6 0 0 1 12.5 3.2z'],
  },
];

/**
 * The deep link a shortcut fires, e.g. `budkin://log/feeding`.
 *
 * The scheme is a parameter rather than a constant because the development
 * variant ships its own (`budkindev`, see app.config.js) so that with both
 * variants installed a shortcut cannot land in the wrong app. Same reason
 * StatusWidget.tsx reads it back out of expo-constants.
 *
 * @param {string} scheme
 * @param {QuickLogShortcut} shortcut
 * @returns {string}
 */
function shortcutDeepLink(scheme, shortcut) {
  return `${scheme}://log/${shortcut.activity}`;
}

module.exports = { GLYPH_COLOR, GLYPH_SCALE, PLATE_PATH, QUICK_LOG_SHORTCUTS, shortcutDeepLink };
