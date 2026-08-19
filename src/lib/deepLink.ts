/**
 * The `?child=` a deep link carries: written, read back, and resolved against the roster
 * here. Notifications and widget buttons are built while one child is current and tapped
 * while another may be, and every write site in the store reads the global selection, so
 * a link has to name its own child.
 *
 * A query parameter rather than a `data` field because it is the only mechanism both
 * producers share: a widget button is an `OPEN_URI` intent with nothing but a url.
 */

import type { Child } from '@/types/models';

/**
 * "No child" is permanent, not transitional: pumping reminders are parent-side, launcher
 * shortcuts are baked in at prebuild time, and `diffScheduled` compares identifier, title
 * and body only, so reminders pending from an older build keep their childless url.
 */
export function withChildParam(url: string, childId: string | undefined): string {
  if (!childId) return url;
  return `${url}${url.includes('?') ? '&' : '?'}child=${encodeURIComponent(childId)}`;
}

/**
 * Hand-parsed rather than through expo-linking's `parse`: pulling a native Expo module
 * into a pure `@/lib` module would put it out of vitest's reach. React Native's own
 * URL/URLSearchParams support is partial, and these urls are app-generated anyway.
 */
function childParam(url: string): string | undefined {
  const query = url.split('#')[0].split('?')[1];
  if (!query) return undefined;
  for (const pair of query.split('&')) {
    const [key, ...rest] = pair.split('=');
    if (key !== 'child') continue;
    const raw = rest.join('=');
    try {
      return decodeURIComponent(raw) || undefined;
    } catch {
      // A malformed escape falls back to the raw value rather than throwing: nothing
      // here may blow up inside a notification tap.
      return raw || undefined;
    }
  }
  return undefined;
}

/** Which child a link names, resolved against the roster it will open into. */
export type DeepLinkChild =
  /** the link names nobody, so it runs against whoever is selected */
  | { kind: 'current' }
  /** the link names a child the roster still holds, possibly the selected one */
  | { kind: 'named'; child: Child }
  /** the link names a child the roster no longer holds */
  | { kind: 'unknown' };

export function resolveDeepLinkChild(child: string | undefined, children: Child[]): DeepLinkChild {
  const id = child?.trim();
  if (!id) return { kind: 'current' };
  const named = children.find((c) => c.id === id);
  return named ? { kind: 'named', child: named } : { kind: 'unknown' };
}

/**
 * The child a notification tap should select before it navigates, or undefined to leave
 * the selection alone.
 *
 * Only for navigation-only destinations, which read the global selection and so have no
 * other way to reach the child the reminder is about. Write-adjacent destinations
 * ('/log/<type>', '/timer') resolve the parameter in their own route instead: they have
 * to refuse an unknown child rather than aim a write at whoever is selected, and a
 * widget button reaches them without passing through this funnel at all.
 */
export function childToSelectOnOpen(url: string, children: Child[], selectedChildId: string): string | undefined {
  const path = url.split('?')[0];
  if (path === '/timer' || path.startsWith('/log/')) return undefined;
  const named = resolveDeepLinkChild(childParam(url), children);
  if (named.kind !== 'named' || named.child.id === selectedChildId) return undefined;
  return named.child.id;
}

export type TimerDeepLinkAction =
  /** not connected, expecting, or a child we no longer have */
  | { kind: 'none' }
  /** start the quick timer, selecting this child first when the link names one */
  | { kind: 'start'; selectChildId: string | undefined };

/**
 * The routing decision behind `budkin://timer` (the widget's Timer button). Judged
 * against the child the LINK names, not the one selected: the widget's bitmap can be
 * older than the selection it was rendered from. A child the roster no longer holds is
 * refused rather than retargeted, because starting a timer writes a real entry.
 */
export function resolveTimerDeepLink(params: {
  child: string | undefined;
  connected: boolean;
  children: Child[];
  selectedChildId: string;
}): TimerDeepLinkAction {
  if (!params.connected) return { kind: 'none' };
  const named = resolveDeepLinkChild(params.child, params.children);
  if (named.kind === 'unknown') return { kind: 'none' };
  const target = named.kind === 'named' ? named.child : params.children.find((c) => c.id === params.selectedChildId);
  // Timing a child who is still expected would log against a due date rather than a
  // birth date. Same guard log/[type].tsx mirrors.
  if (target?.expected) return { kind: 'none' };
  const id = named.kind === 'named' ? named.child.id : undefined;
  return { kind: 'start', selectChildId: id && id !== params.selectedChildId ? id : undefined };
}
