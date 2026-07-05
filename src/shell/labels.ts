/**
 * Pure label helpers for the desktop top bar. Kept separate from the React
 * component so they are unit-testable in the node test environment.
 */

/** Time-of-day greeting eyebrow, per the web design handoff. */
export function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Late night';
}

/** Screen title for a given route path; the dashboard is personalised. */
export function screenTitleFor(pathname: string, childFirst?: string): string {
  switch (pathname) {
    case '/':
      return childFirst ? `${childFirst}'s day` : 'Dashboard';
    case '/timers':
      return 'Timers';
    case '/history':
      return 'History';
    case '/growth':
      return 'Growth';
    case '/settings':
      return 'Settings';
    case '/insights':
      return 'Insights';
    default:
      return 'Budkin';
  }
}
