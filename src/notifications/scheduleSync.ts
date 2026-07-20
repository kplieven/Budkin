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
  for (const e of s.entries) {
    if (e.type !== 'pumping') continue;
    const at = e.end ?? e.start;
    if (lastPumpAt === null || at > lastPumpAt) lastPumpAt = at;
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
    },
    lastPumpAt,
  };
}

export function initScheduledReminderSync(): void {
  if (started) return;
  started = true;

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
  let busy = false;
  let queued: State | null = null;
  const run = (s: State) => {
    if (busy) {
      queued = s;
      return;
    }
    busy = true;
    void applyScheduled(desiredScheduled(toInput(s), Date.now())).finally(() => {
      busy = false;
      if (queued) {
        const next = queued;
        queued = null;
        run(next);
      }
    });
  };

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
      state.pumpingEnabledAt === previous.pumpingEnabledAt
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
