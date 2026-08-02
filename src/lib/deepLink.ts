/**
 * The `?child=` a deep link carries: written here, read back here, and resolved
 * against the roster here. Notifications and widget buttons are built while one
 * child is current and tapped while another may be, and every write site in the
 * store reads the global selection, so a link that means "this is about Wren"
 * has to say so.
 *
 * A query parameter rather than a `data` field because it is the only mechanism
 * both producers share: a widget button is an `OPEN_URI` intent with nothing but
 * a url, and the notification funnel already navigates by url.
 *
 * Pure, and a `.ts` module rather than route code, for the reason
 * `logDeepLink.ts` gives at the top of that file: vitest only reaches `.ts`.
 * `resolveTimerDeepLink` lives here rather than in a file of its own because it
 * is a few lines of policy over the resolution above; the log route's decision
 * is big enough to keep its own module.
 */

import type { Child } from '@/types/models';

/** Appends `?child=<id>`, or nothing at all when there is no child to name.
 *
 *  "No child" is a PERMANENT case, not a transitional one: pumping reminders are
 *  parent-side, launcher shortcuts are baked in at prebuild time before any child
 *  exists, and a timer persisted before ownership was stamped has no owner. On top
 *  of that, `diffScheduled` compares identifier, title and body only, so every
 *  reminder already pending from an older build keeps its childless url until its
 *  identifier changes for an unrelated reason. Every reader below degrades to the
 *  current selection instead. */
export function withChildParam(url: string, childId: string | undefined): string {
  if (!childId) return url;
  return `${url}${url.includes('?') ? '&' : '?'}child=${encodeURIComponent(childId)}`;
}

/**
 * The `child` parameter of a deep-link url. Only the notification funnel needs
 * this; route components get their params already parsed and decoded from
 * expo-router.
 *
 * Hand-parsed rather than through expo-linking's `parse`, which is a declared
 * dependency this repo has never imported: pulling a native Expo module into a
 * pure `@/lib` module would put it out of vitest's reach (node environment, no
 * native shim), which is the whole reason this decision lives here rather than in
 * the route. React Native's own URL/URLSearchParams support is partial, and these
 * urls are app-generated anyway, an absolute path or our own scheme.
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
      // A malformed escape. Fall back to the raw value rather than throwing: the
      // lookup below either matches a child or does not, and neither answer may
      // blow up inside a notification tap.
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
 * The child a notification tap should select before it navigates, or undefined
 * to leave the selection alone.
 *
 * Only for NAVIGATION-only destinations ('/', '/timers', '/history',
 * '/milestones'): those are plain tabs reading the global selection, with no
 * deep-link route of their own, so the funnel is the only place that can point
 * them at the child the reminder is about. An unknown child is ignored rather
 * than dead-ending, matching how `logDeepLink` already treats a treatment that
 * outlived the alert naming it.
 *
 * Write-adjacent destinations ('/log/<type>', '/timer') are deliberately left
 * out. Their own route resolves the parameter, because it has to refuse an
 * unknown child rather than silently aim a write at whoever is selected, and
 * because a widget button reaches them without passing through this funnel at
 * all: deciding here as well would split one url's behaviour by entry point.
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
 * The routing decision behind `budkin://timer` (the widget's Timer button).
 *
 * Everything is judged against the child the LINK names, not the one selected:
 * the widget's bitmap can be older than the selection it was rendered from, so
 * the button carries who it was showing. A child the roster no longer holds is
 * refused rather than retargeted, the same line `logDeepLink` draws, because
 * starting a timer writes a real entry against whoever ends up selected.
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
  // Timing a child who is still expected would log an activity against a due
  // date rather than a birth date. Same guard log/[type].tsx mirrors.
  if (target?.expected) return { kind: 'none' };
  const id = named.kind === 'named' ? named.child.id : undefined;
  return { kind: 'start', selectChildId: id && id !== params.selectedChildId ? id : undefined };
}
