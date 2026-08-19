/** Pure label helpers for the desktop top bar, kept out of the component so they
 *  are unit-testable. */

/** Time-of-day greeting eyebrow, per the web design handoff. */
export function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Late night';
}

export function screenTitleFor(pathname: string, childFirst?: string): string {
  switch (pathname) {
    case '/':
      return childFirst ? `${childFirst}'s day` : 'Dashboard';
    case '/timers':
      return 'Timers';
    case '/history':
      return 'History';
    case '/notes':
      return 'Notes';
    case '/growth':
      return 'Growth';
    case '/milestones':
      return 'Milestones';
    case '/settings':
      return 'Settings';
    case '/settings/notifications':
      return 'Notifications';
    case '/settings/queue':
      return 'Offline queue';
    case '/insights':
      return 'Insights';
    default:
      return 'Budkin';
  }
}
