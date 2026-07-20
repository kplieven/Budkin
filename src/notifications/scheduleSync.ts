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
  const run = (s: State) => void applyScheduled(desiredScheduled(toInput(s), Date.now()));
  // Gate on the slices the desired set derives from. The per-second `now` tick
  // changes nothing here: fire times are absolute, so a launch-time run plus
  // state-change runs is sufficient and a tick-driven rebuild would be pure
  // churn.
  useAppStore.subscribe((state, previous) => {
    if (
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
  run(useAppStore.getState());
}
