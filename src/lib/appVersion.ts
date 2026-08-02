/**
 * The build's version, as the single line both screens draw.
 *
 * Returns the COMPLETE line rather than a fragment, so Settings and onboarding
 * cannot drift apart: there is one string, built once, and neither screen
 * decides anything about it.
 *
 * Kept out of the `.tsx` files because `vitest.config.ts` only matches
 * `.test.ts`: a rule living in a component is untestable by convention here
 * (same reason `src/lib/logTargets.ts` and
 * `src/features/activity/queuedMarker.ts` exist).
 *
 * `raw` is whatever `app.config.js` resolved into `extra.version`: the
 * `BUDKIN_VERSION` the build was given, else a host `git describe`, else
 * nothing. Absent, empty and whitespace all mean the same thing and all render
 * as "dev", which is deliberate. A build that cannot say what it is should look
 * obviously unknown rather than quietly claim a version it is not, because the
 * whole point of showing a version is to be believed.
 */
export function versionLabel(raw: string | undefined): string {
  const version = raw?.trim();
  return `Budkin ${version ? version : 'dev'}`;
}
