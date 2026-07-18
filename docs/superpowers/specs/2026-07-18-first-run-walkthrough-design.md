# First-run walkthrough carousel

## Goal

Give a brand-new user a short, friendly tour of what Budkin does the first time
they open the app, and let anyone replay it later from Settings.

## Form

A full-screen, swipeable carousel of five intro slides. It does not spotlight or
point at real UI, so it stays robust across phone and desktop web. It runs once
on a fresh install, before the existing connect-your-server screen, and can be
replayed anytime from Settings.

Rejected alternatives (decided during brainstorming):

- **Spotlight coach-marks** on the live Home screen: the most "walk through the
  app" feel, but needs real element measurement and is fragile across phone +
  desktop, tabs, and overlays. Not worth the risk for a first-run tour.
- **Hybrid** (welcome slide + a few spotlights): same measurement risk, largest
  build.

## Slides

Five slides, each a large icon in a tinted circle, a bold headline, and one line
of body copy. Icons come from the existing `Icon` set (`src/components/Icon.tsx`).

| # | Icon | Headline | Body |
|---|------|----------|------|
| 1 | heart | Welcome to Budkin | A calm, fast way to track your baby's day, from feeds and naps to the milestones in between. |
| 2 | feeding | Log in seconds | Tap a tile on Home to record a feed, nap, diaper, bath and more. Smart defaults mean most logs are one or two taps. |
| 3 | timer | Timers for naps and feeds | Start a live timer and save it as any activity when you're done. On Android there's even a home-screen widget to start a nap without opening the app. |
| 4 | insights | See the patterns | History, Insights, Growth and Milestones turn your entries into trends: sleep totals, feeding rhythms, growth curves. |
| 5 | home | Yours, offline-first | Budkin works fully offline and keeps data on your device. Connect your own Baby Buddy server to sync across devices, or start now and connect later. |

Slide copy and icons live in a dedicated `src/features/walkthrough/slides.ts`
array so the deck is inspectable and the carousel component stays presentational.

## Interaction

- Horizontal paging: swipe, or tap the primary button to advance.
- A page-dot indicator shows position (5 dots, active dot filled).
- A **Skip** control sits in the top corner on every slide except the last.
- The primary button reads **Next** on slides 1 through 4 and **Get started** on
  slide 5. Both Skip and Get started dismiss the carousel.
- Respects safe-area insets. On desktop web the content renders as a centered,
  max-width column (the deck is not full-bleed on wide screens).
- Theme-aware via `useTheme()` tokens, matching the rest of the app.

## First-run trigger and persistence

- Add `tutorialSeen?: boolean` to `Prefs` in `src/data/prefs.ts`. It rides in the
  existing `babybuddy.prefs.v1` AsyncStorage blob (same merge-on-save path as
  `themeMode` and `unitSystem`), so no new storage key.
- Load it in the store's `hydrate()` into a new `tutorialSeen: boolean` state
  field (default `false`), alongside the existing `prefs.themeMode` /
  `prefs.unitSystem` restore.
- Add a store action `completeTutorial()` that sets `tutorialSeen: true` and
  calls `savePrefs({ tutorialSeen: true })`.
- New route `src/app/welcome.tsx` renders the carousel. It is registered in the
  root `Stack` (`src/app/_layout.tsx`) and excluded from the desktop sidebar
  shell exactly like `onboarding` (extend the `showShell` guard to also exclude
  `welcome`).
- `src/app/index.tsx` redirect logic becomes:
  1. `!tutorialSeen` then `/welcome`
  2. else `connected` then `/(tabs)`
  3. else `/onboarding`
- Dismissing the carousel calls `completeTutorial()` and then navigates:
  - First run (no `replay` param): `router.replace('/onboarding')` when not
    connected, or `/(tabs)` if somehow already connected.
  - Replay from Settings (`/welcome?replay=1`): `router.back()`.

  The `replay` search param is how the route tells the two entry points apart.

## Settings re-run button

Add a new **Help** section at the bottom of the Settings screen
(`src/app/settings.tsx`), styled like the existing groups (surface card, section
label). It holds a single tappable row, **Show the walkthrough**, that does
`router.push('/welcome?replay=1')`.

## Files touched

- `src/data/prefs.ts`: add `tutorialSeen` field.
- `src/store/useAppStore.ts`: `tutorialSeen` state, `completeTutorial()` action,
  restore in `hydrate()`.
- `src/features/walkthrough/slides.ts`: the five-slide deck data (new).
- `src/features/walkthrough/Walkthrough.tsx`: the carousel component (new).
- `src/app/welcome.tsx`: the route wrapper (new).
- `src/app/_layout.tsx`: register the `welcome` Stack screen, exclude from shell.
- `src/app/index.tsx`: first-run redirect branch.
- `src/app/settings.tsx`: Help section with the replay row.

## Testing

- Store test (`src/store/useAppStore.test.ts`): `completeTutorial()` sets
  `tutorialSeen` and persists via `savePrefs`; `hydrate()` restores a persisted
  `tutorialSeen: true`.
- Keep the carousel presentational and driven by `slides.ts` so its content is
  verifiable by inspection; no snapshot test needed.
- Manual verification: fresh install shows the carousel before connect; Skip and
  Get started both land on the connect screen and set the flag; relaunch skips
  the carousel; the Settings row replays it and returns via back.

## Out of scope

- No spotlight/coach-mark overlays on live screens.
- No per-tab or contextual tips beyond the five-slide deck.
- No analytics on slide completion.
