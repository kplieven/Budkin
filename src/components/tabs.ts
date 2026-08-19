/**
 * The bottom bar's tabs, in bar order.
 *
 * A plain table rather than something read off the navigator, because the bar is
 * rendered from two places: inside the (tabs) group, where a tap is a tab jump and
 * the navigator supplies the routes, and on the Timers screen, which sits on the root
 * Stack and has no tab navigator to ask.
 *
 * Timers is deliberately absent: it is not in this group at all, and is reached from
 * Home.
 */

import type { IconName } from '@/components/Icon';

export const TABS = {
  // Home is a route GROUP holding a Stack (Home -> Timers), so the tab's route name
  // carries its parentheses. The URL is unaffected: groups never appear in the path,
  // so this tab is still "/".
  '(home)': { label: 'Home', icon: 'home' },
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
 * The tab navigator reports its active route as a plain string, and the group may hold a
 * route the bar does not show, so this keeps such a route from being cast into a name the
 * table has no entry for. It simply lights nothing up.
 */
export function isTabName(name: string | null | undefined): name is TabName {
  return name != null && name in TABS;
}
