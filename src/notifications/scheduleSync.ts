/** Keeps Android's pending reminder set in sync with the store. */

import { reachedForChild } from '@/lib/milestones';
import { applyScheduled } from '@/notifications/applySchedule';
import { desiredScheduled, type ScheduleInput } from '@/notifications/scheduled';
import { treatmentDoseScalars, entriesForChild } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import type { Treatment } from '@/types/models';

let started = false;

type State = ReturnType<typeof useAppStore.getState>;

// `lastSleepEndByChild` and `asleepChildIds` must stay POPULATED for every child:
// a per-child key that goes missing reads to the next diff as "no longer desired"
// and cancels that child's pending nap reminder.
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
        const cur = lastSleepEndByChild[e.childId];
        if (cur == null || e.end > cur) lastSleepEndByChild[e.childId] = e.end;
      } else {
        // Ongoing, and not always with a running Timer: editing an entry to
        // "still ongoing" writes `end: null` without creating one.
        asleepChildIds[e.childId] = true;
      }
    }
  }

  // Grouped per child rather than passed in one call: `treatmentDoseScalars`
  // attributes a dose by trimmed, case-insensitive NAME, so one flat call would
  // let a dose logged for one child settle a sibling's identically named regimen.
  const treatmentsByChild = new Map<string, Treatment[]>();
  for (const t of s.treatments) {
    const group = treatmentsByChild.get(t.childId);
    if (group) group.push(t);
    else treatmentsByChild.set(t.childId, [t]);
  }
  const treatmentDoses: Record<string, { today: number; lastAt: number | null }> = {};
  for (const [childId, group] of treatmentsByChild) {
    Object.assign(treatmentDoses, treatmentDoseScalars(group, entriesForChild(s.entries, childId), now));
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
    treatments: s.treatments,
    treatmentDoses,
    reachedMilestoneKeysByChild: Object.fromEntries(
      s.children.map((c) => [c.id, [...reachedForChild(s.entries, c.id).keys()]]),
    ),
    answeredMilestoneKeysByChild: s.answeredMilestonePrompts,
  };
}

// Runs must not overlap. `applyScheduled` reads Android's pending set and then
// writes to it across several awaits, so a stale run's cancel can land after a
// fresh run has already read the pre-cancel state, leaving a reminder cancelled
// with nothing to reschedule it. Module-scoped so `reconcileNow` shares the latch.
let busy = false;
let queued: State | null = null;
function run(s: State): void {
  if (busy) {
    queued = s;
    return;
  }
  // Built before `busy` flips, so a throw cannot latch it true. One `now` for
  // all three, so nothing here straddles a local midnight.
  const now = Date.now();
  const input = toInput(s, now);
  const desired = desiredScheduled(input, now);
  busy = true;
  void applyScheduled(desired, input, now).finally(() => {
    busy = false;
    if (queued) {
      const next = queued;
      queued = null;
      run(next);
    }
  });
}

/** For the two call sites that change what Android should hold WITHOUT touching
 *  a gated store slice: granting permission, and returning to the foreground. */
export function reconcileNow(): void {
  const state = useAppStore.getState();
  if (state.hydrating) return;
  run(state);
}

export function initScheduledReminderSync(): void {
  if (started) return;
  started = true;

  useAppStore.subscribe((state, previous) => {
    // Never reconcile against a store that is still hydrating: `children` is
    // still `[]`, so the run would cancel the user's entire reminder set.
    if (state.hydrating) return;
    // `hydrating` is in this list on purpose: without it, the set() that flips it
    // false at the end of hydrate() reads as "nothing changed" and the
    // post-hydration reconcile never runs. `selectedChildId` is deliberately
    // absent: nothing in the desired set reads the selection.
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
      state.treatments === previous.treatments &&
      state.treatmentReminders === previous.treatmentReminders &&
      state.treatmentRemindersEnabledAt === previous.treatmentRemindersEnabledAt &&
      state.milestoneCatchUp === previous.milestoneCatchUp &&
      // Answering the nudge retires a milestone and must cancel its alert.
      state.answeredMilestonePrompts === previous.answeredMilestonePrompts
    ) {
      return;
    }
    run(state);
  });

  // Skip the launch-time run while hydrating: the subscriber above covers it.
  const initial = useAppStore.getState();
  if (!initial.hydrating) run(initial);
}
