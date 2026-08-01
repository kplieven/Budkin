/**
 * The bottom bar's tabs, in bar order.
 *
 * A plain table rather than something read off the navigator, because the bar
 * is rendered from two places: inside the (tabs) group, where a tap is a tab
 * jump and the navigator supplies the routes, and on the Timers screen, which
 * sits on the root Stack and has no tab navigator to ask. One table keeps the
 * two bars showing the same items in the same order.
 *
 * Timers is deliberately absent: it is not in this group at all (see the root
 * layout), and it is reached from Home.
 */

import type { Href } from 'expo-router';

import type { IconName } from '@/components/Icon';

export const TABS = {
  index: { label: 'Home', icon: 'home' },
  history: { label: 'History', icon: 'list' },
  insights: { label: 'Insights', icon: 'insights' },
  growth: { label: 'Growth', icon: 'chart' },
  milestones: { label: 'Milestones', icon: 'milestone' },
  notes: { label: 'Notes', icon: 'note' },
} satisfies Record<string, { label: string; icon: IconName }>;

export type TabName = keyof typeof TABS;

/** Bar order. Matches the screen order in the group's layout. */
export const TAB_NAMES = Object.keys(TABS) as TabName[];

/**
 * Whether a route name is one of the bar's own. The tab navigator reports its
 * active route as a plain string, and the group may hold a route the bar does
 * not show, so this is what keeps such a route from being cast into a name the
 * table has no entry for: it simply lights nothing up.
 */
export function isTabName(name: string | null | undefined): name is TabName {
  return name != null && name in TABS;
}

/**
 * Where a tab lives, for a caller that has to navigate to it rather than
 * switch to it. Home is the group's initial route (`unstable_settings` in the
 * group layout), so it is addressed as the group itself.
 */
export function tabHref(name: TabName): Href {
  return name === 'index' ? '/(tabs)' : `/(tabs)/${name}`;
}
