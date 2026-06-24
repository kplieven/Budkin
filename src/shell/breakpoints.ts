/**
 * Pure breakpoint logic for the responsive web/desktop shell.
 *
 * React Native has no CSS `@media`; responsiveness is decided in JS from the
 * viewport width. This module holds the *pure* decision so it is unit-testable
 * in the node test environment — the React hook ({@link useDesktopShell}) is a
 * thin, SSR-safe wrapper around it.
 *
 * Thresholds follow the web design handoff: the large-screen shell targets
 * tablet-landscape and laptops (≥ ~1024px), and the 372px timeline rail only
 * appears once there is room for it (≥ ~1180px; below that the handoff collapses
 * the rail).
 */

/** Minimum viewport width that renders the desktop shell instead of phone tabs. */
export const DESKTOP_MIN_WIDTH = 1024;

/** Minimum viewport width that has room for the dashboard's 372px timeline rail. */
export const RAIL_MIN_WIDTH = 1180;

/** Whether `width` should render the large-screen desktop shell. */
export function isDesktopWidth(width: number): boolean {
  return width >= DESKTOP_MIN_WIDTH;
}

/** Whether `width` has room for the dashboard timeline rail. */
export function showRail(width: number): boolean {
  return width >= RAIL_MIN_WIDTH;
}
