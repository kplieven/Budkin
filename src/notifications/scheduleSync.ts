/**
 * Keeps Android's pending reminder set in sync with the store, the scheduled
 * twin of `sync.ts`. On every relevant store change, rebuild the desired set and
 * hand it to the platform reconciler. No-ops cleanly off Android.
 */

import { reachedForChild } from '@/lib/milestones';
import { applyScheduled } from '@/notifications/applySchedule';
import { desiredScheduled, type ScheduleInput } from '@/notifications/scheduled';
import { cureDoseScalars, entriesForChild } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';

let started = false;

type State = ReturnType<typeof useAppStore.getState>;

// In SERVER mode, `s.entries` only ever holds the one child the last fetch
// asked for (see the invariant around `useAppStore.ts:1566`; `repository.ts`
// fetches sleep for `selectedChildId` only). So `lastPumpAt` and
// `lastSleepEndByChild`/`asleepChildIds` below can only ever reflect ONE
// child at a time in server mode, and `selectChild`'s `refresh()` replaces
// `entries` wholesale, which drops the previous child's key entirely — the
// next diff then reads that as "no longer desired" and cancels that child's
// already-pending nap reminder. Inherited from `lastPumpAt`'s existing shape;
// fixing it (fetching sleep for every child) is out of scope here.
function toInput(s: State, now: number): ScheduleInput {
  let lastPumpAt: number | null = null;
  const lastSleepEndByChild: Record<string, number> = {};
  const asleepChildIds: Record<string, true> = {};
  for (const e of s.entries) {
    if (e.type === 'pumping') {
      const at = e.end ?? e.start;
      if (lastPumpAt === null || at > lastPumpAt) lastPumpAt = at;
      continue;
    }
    if (e.type === 'sleep') {
      if (e.end != null) {
        // Ended: starts a wake window.
        const cur = lastSleepEndByChild[e.childId];
        if (cur == null || e.end > cur) lastSleepEndByChild[e.childId] = e.end;
      } else {
        // Ongoing. Often also has a running Timer (already caught by
        // `napReminders`' own `timers` check), but not always: editing an
        // existing entry to "still ongoing" writes `end: null` without
        // creating a Timer, and a server sleep record with no end maps the
        // same way. `asleepChildIds` catches the child in either case, so a
        // stale, still-future `fireAt` from the PREVIOUS ended sleep can't
        // survive and suggest a nap while the baby is asleep.
        asleepChildIds[e.childId] = true;
      }
    }
  }
  return {
    children: s.children,
    timers: s.timers,
    prefs: {
      dueDateReminders: s.dueDateReminders,
      staleTimerReminders: s.staleTimerReminders,
      ageMilestones: s.ageMilestones,
      pumpingReminders: s.pumpingReminders,
      pumpingIntervalMin: s.pumpingIntervalMin,
      pumpingEnabledAt: s.pumpingEnabledAt,
      napSuggestions: s.napSuggestions,
      treatmentReminders: s.treatmentReminders,
      treatmentRemindersEnabledAt: s.treatmentRemindersEnabledAt,
      milestoneCatchUp: s.milestoneCatchUp,
    },
    lastPumpAt,
    lastSleepEndByChild,
    asleepChildIds,
    selectedChildId: s.selectedChildId,
    cures: s.cures,
    // Scoped to the selected child on both sides, for the reason in the comment
    // above this function: in server mode `s.entries` only ever holds one child,
    // so counting doses for anyone else would silently read another child's
    // history as empty.
    cureDoses: cureDoseScalars(
      s.cures.filter((c) => c.childId === s.selectedChildId),
      entriesForChild(s.entries, s.selectedChildId),
      now,
    ),
    // Scoped to the selected child on both halves, for the same reason as
    // `cureDoses` above. `answeredMilestonePrompts` is already keyed by child;
    // `reachedForChild` does the filtering for the other.
    reachedMilestoneKeys: [...reachedForChild(s.entries, s.selectedChildId).keys()],
    answeredMilestoneKeys: s.answeredMilestonePrompts[s.selectedChildId] ?? [],
  };
}

// Runs must not overlap. `applyScheduled` reads Android's pending set and
// then writes to it across several awaits, so two in-flight runs can
// interleave: a stale run's cancel can land after a fresh run already read
// the pre-cancel state and concluded there was nothing to do, leaving a
// reminder cancelled with nothing left to reschedule it. `hydrate()` alone
// issues many separate set() calls, so this is not an edge case.
//
// Coalesce instead of queueing every call: while a run is in flight, keep
// only the LATEST state that arrived and run once more with it after the
// current run finishes. Only the last desired set matters, so this also
// avoids a burst of redundant native round trips during hydration.
//
// Module-scoped, not local to initScheduledReminderSync, so `reconcileNow`
// below shares this exact latch instead of running its own: two independent
// busy flags could still let a store-driven run and a manual reconcile
// interleave, which is the exact hazard this latch exists to close.
let busy = false;
let queued: State | null = null;
function run(s: State): void {
  if (busy) {
    queued = s;
    return;
  }
  // Built before `busy` flips, so a throw here (a malformed toInput or
  // desiredScheduled call) never latches `busy` true. Nothing set it, so the
  // next call is still free to run instead of queueing behind a flag that no
  // `finally` will ever clear.
  // One `now` for both, so the dose scalars and the schedule cannot straddle a
  // local midnight and disagree about what "today" means.
  const now = Date.now();
  const desired = desiredScheduled(toInput(s, now), now);
  busy = true;
  void applyScheduled(desired).finally(() => {
    busy = false;
    if (queued) {
      const next = queued;
      queued = null;
      run(next);
    }
  });
}

/**
 * Request a reconcile right now, through the same coalescing latch `run`
 * above uses for every store-driven reconcile. For the two call sites that
 * change what Android should hold WITHOUT touching a gated store slice:
 * granting permission from the notifications settings screen, and the app
 * returning to the foreground (see `_layout.tsx`). Mirrors the subscriber's
 * `hydrating` guard below: a reconcile against the pre-hydrate() empty store
 * would read every pending reminder as no longer desired and cancel the
 * user's whole set. Never requests permission itself; `applyScheduled` only
 * checks it.
 */
export function reconcileNow(): void {
  const state = useAppStore.getState();
  if (state.hydrating) return;
  run(state);
}

export function initScheduledReminderSync(): void {
  if (started) return;
  started = true;

  useAppStore.subscribe((state, previous) => {
    // Never reconcile against a store that is still hydrating: `children` and
    // friends are still at their pre-hydrate() initial values (in particular
    // `children: []`), so a run here would read every pending reminder as no
    // longer desired and cancel the user's entire reminder set. It is
    // restored only once hydrate()'s final set() flips `hydrating` to false,
    // which the slice comparison below (via the `hydrating` slice) catches.
    if (state.hydrating) return;
    // Gate on the slices the desired set derives from, plus `hydrating`
    // itself: without it, a set() that flips only `hydrating` (the true-to-
    // false transition hydrate() ends with, when nothing else in this list
    // also changed) would look like "nothing changed" and be skipped, so the
    // post-hydration reconcile above would never actually run. The per-second
    // `now` tick changes nothing here: fire times are absolute, so a
    // launch-time run plus state-change runs is sufficient and a tick-driven
    // rebuild would be pure churn.
    //
    // `selectedChildId` is a genuine input, not just a `timers`-adjacent
    // disambiguator: `napReminders` resolves an ownerless running sleep
    // timer's owner as `timer.childId ?? input.selectedChildId`. Every current
    // timer source, including the headless widget, stamps a childId, so
    // "ownerless" only happens for a timer persisted before that stamping
    // existed — but while it can happen, which child is selected can flip
    // which child's nap nudge is suppressed even though `timers` itself did
    // not change.
    if (
      state.hydrating === previous.hydrating &&
      state.children === previous.children &&
      state.timers === previous.timers &&
      state.entries === previous.entries &&
      state.dueDateReminders === previous.dueDateReminders &&
      state.staleTimerReminders === previous.staleTimerReminders &&
      state.ageMilestones === previous.ageMilestones &&
      state.pumpingReminders === previous.pumpingReminders &&
      state.pumpingIntervalMin === previous.pumpingIntervalMin &&
      state.pumpingEnabledAt === previous.pumpingEnabledAt &&
      state.napSuggestions === previous.napSuggestions &&
      state.cures === previous.cures &&
      state.treatmentReminders === previous.treatmentReminders &&
      state.treatmentRemindersEnabledAt === previous.treatmentRemindersEnabledAt &&
      state.milestoneCatchUp === previous.milestoneCatchUp &&
      // Answering the home-screen nudge retires that milestone, which must
      // cancel its pending notification. Nothing else in this list moves when
      // it does: `answerMilestonePrompt` writes only this slice, so without it
      // the alert would survive until the next foreground reconcile and ask
      // about a milestone the parent has already answered.
      state.answeredMilestonePrompts === previous.answeredMilestonePrompts &&
      state.selectedChildId === previous.selectedChildId
    ) {
      return;
    }
    run(state);
  });

  // Skip the launch-time run while still hydrating: it would reconcile
  // against the pre-hydrate() empty state, and the subscriber above already
  // runs once hydration completes.
  const initial = useAppStore.getState();
  if (!initial.hydrating) run(initial);
}
