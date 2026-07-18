# Onboarding setup wizard

## Goal

Turn first run from a passive text carousel into a branching setup flow that
asks the two questions a new user actually needs answered: where does my data
live, and who am I tracking. The existing five-slide deck was informative but
left the user on an empty Home with no child and no prompt to add one.

## Form

A short wizard of real questions, each a full screen with large tap targets.
Two branches, both ending on a usable Home:

```
/welcome   "Welcome to Budkin" + "Do you have a Baby Buddy server?"
  |- [Yes, I have a server] -> /onboarding  (the existing connect form)
  |      |- connected -> server has children? -yes-> finish
  |                                          |-no-> /setup/baby
  |- [Just this device] -> enterLocal() -> /setup/baby

/setup/baby   "Has your baby arrived?"
  |- [Yes, they're here] -> first name + birthday -> [Add baby] -> saveChild() -> finish
  |                                                |- "Skip for now" -> finish
  |- [Not yet] -> "We'll be ready when they arrive" -> [Got it] -> finish

finish = completeTutorial() + router.replace('/(tabs)')
```

Rejected alternatives (decided during brainstorming):

- **Keep the carousel, then ask the questions**: nothing is lost, but first run
  becomes five swipes before the first real decision.
- **Delete the slides entirely**: leanest, but throws away a feature tour that
  already works and that some users will want.
- **Rebuild the connect form inside the wizard**: cleaner visual consistency,
  but risks losing the saved-server reconnect and error handling already proven
  in `src/app/onboarding.tsx`.

## The tour keeps its slides

The five slides in `src/features/walkthrough/slides.ts` and the `Walkthrough`
carousel component are unchanged. They stop being part of first run and become
a Settings-only feature tour at a new `/tour` route, relabelled "How Budkin
works". First run is setup, the tour is reference. Someone who wants both can
have both, in the order that suits them.

## Routes and files

| File | Change |
|---|---|
| `src/app/welcome.tsx` | Rewritten: welcome copy plus the two-button server question. Drops its `?replay` handling, which moves to `/tour`. |
| `src/app/tour.tsx` | New. Renders `<Walkthrough onDone={router.back} />`. Does not touch `tutorialSeen`. |
| `src/app/setup/baby.tsx` | New. The born/expecting fork and the child form, one route with internal step state so back steps within the fork. |
| `src/app/onboarding.tsx` | Back arrow guarded by `router.canGoBack()`, the "No server? Start now" link removed, and the `connected` effect branches on `children.length`. |
| `src/app/settings.tsx` | Help row points at `/tour` with the new label. |
| `src/app/(tabs)/index.tsx` | No-child empty state: a card with an "Add your baby" button calling `openAddChild()`. |
| `src/features/walkthrough/*` | Untouched. |

## State and data

No data model change. The wizard orchestrates store actions that already exist:
`enterLocal`, `connect`, `saveChild`, `completeTutorial`. `saveChild` on create
already assigns a local id, auto-selects the new child, and pushes it to the
server when connected (`src/store/useAppStore.ts:1088`), so the
server-with-zero-children branch needs no special casing: it calls the same
action the local branch does.

One extraction: `clampBirth` currently lives inside
`src/features/childSwitcher/ChildSheet.tsx`. It moves to a shared module so the
setup form reuses the same date clamping rather than duplicating it.

## Why the connect form is reused rather than rebuilt

`src/app/onboarding.tsx` already handles saved servers, per-server reconnect,
in-flight state, connect errors, and the "where do I find my token" help. All of
that is load-bearing and none of it is onboarding-specific. It gains a back
arrow so it reads as step two, and loses its "No server? Start now" escape hatch
because that is now the other branch of the question preceding it.

## Edge cases

- `tutorialSeen` stays false for the whole flow, so Home's redirect gate
  (`src/app/(tabs)/index.tsx:69`) returns anyone who reaches Home early to
  setup. `finish()` sets it before the replace, in both branches.
- Backing out of the baby step in the local branch leaves local mode active.
  Choosing "Yes, I have a server" afterwards calls `connect()`, which overwrites
  the connection, so this is safe.
- A returning user who disconnects lands on `/onboarding` with no back target,
  hence the `canGoBack()` guard on the arrow.
- Web `/` route shadowing does not apply: `/welcome`, `/tour`, and `/setup/baby`
  are distinct paths. Home's existing gate stays as it is.
- Skipping the baby step, and the "Not yet" branch, both reach Home with no
  child. That is what the new empty state is for.

## Testing

Unit tests for the extracted `clampBirth` and for the finish-routing decision
(zero children versus some children after a successful connect). Then a real
web run driving both branches end to end, because the point of this work is
that the flow feels right, not that it type-checks.

## Follow-up: the expecting child state

Decided during brainstorming, deliberately scoped out of this spec and into its
own. Once it lands, the "Not yet" branch stops showing a reassurance screen and
instead collects a name and due date.

- `Child` gains an expected flag, with `birth` holding the due date.
- Age strings become a countdown at all four sites that render them: Home
  header, `Sidebar`, `ChildSwitcher`, and the Android `StatusWidget`.
- Home hides the activity tiles while expected, showing the countdown and a
  "They've arrived" button that captures the real birthday.
- Milestones, Growth, and Insights stay hidden while expected, since all three
  key off an age that would be negative.
- Sync holds the child back: no `pushChildToServer` and no participation in
  `matchServerChild` until the birth is confirmed.

This is the larger of the two pieces and touches the data model, four displays,
three feature views, and sync, which is why it ships second, on top of a
wizard that is already stable.
