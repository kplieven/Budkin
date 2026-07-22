/**
 * Keeps Android's pending reminder set in sync with the store, the scheduled
 * twin of `sync.ts`. On every relevant store change, rebuild the desired set and
 * hand it to the platform reconciler. No-ops cleanly off Android.
 */

import { applyScheduled } from '@/notifications/applySchedule';
import { desiredScheduled, type ScheduleInput } from '@/notifications/scheduled';
import { useAppStore } from '@/store/useAppStore';

let started = false;

type State = ReturnType<typeof useAppStore.getState>;

function toInput(s: State): ScheduleInput {
  let lastPumpAt: number | null = null;
  const lastSleepEndByChild: Record<string, number> = {};
  for (const e of s.entries) {
    if (e.type === 'pumping') {
      const at = e.end ?? e.start;
      if (lastPumpAt === null || at > lastPumpAt) lastPumpAt = at;
      continue;
    }
    // Only an ENDED sleep starts a wake window. A running one means the baby
    // is still asleep, and `timers` already covers that case.
    if (e.type === 'sleep' && e.end != null) {
      const cur = lastSleepEndByChild[e.childId];
      if (cur == null || e.end > cur) lastSleepEndByChild[e.childId] = e.end;
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
    },
    lastPumpAt,
    lastSleepEndByChild,
    selectedChildId: s.selectedChildId,
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
  const desired = desiredScheduled(toInput(s), Date.now());
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
    // timer's owner as `timer.childId ?? input.selectedChildId`, so which
    // child is selected can flip which child's nap nudge is suppressed even
    // though `timers` itself did not change.
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
