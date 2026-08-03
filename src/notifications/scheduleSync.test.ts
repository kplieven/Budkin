import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Treatment, Entry } from '@/types/models';

// In-memory AsyncStorage so the store's data modules load under node.
const mem = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      mem.store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      mem.store.delete(k);
    }),
    // The entity store's month-chunked entries (see src/data/entityStore.ts)
    // use the batch API; without these the chunked saveEntries warns on every
    // store write this file triggers.
    getAllKeys: vi.fn(async () => [...mem.store.keys()]),
    multiGet: vi.fn(async (keys: string[]) => keys.map((k) => [k, mem.store.get(k) ?? null] as const)),
    multiSet: vi.fn(async (pairs: [string, string][]) => {
      for (const [k, v] of pairs) mem.store.set(k, v);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) mem.store.delete(k);
    }),
  },
}));

// `@/data/secureKv` pulls in expo-secure-store (native, transitively
// react-native) via storage/servers; stub it so the store module imports under node.
vi.mock('@/data/secureKv', () => ({
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => {}),
  kvRemove: vi.fn(async () => {}),
}));

// `@/lib/photoFile` pulls in expo-file-system and react-native's Platform,
// both native; stub it so the store module (saveChild's deferred-photo path)
// imports under node.
vi.mock('@/lib/photoFile', () => ({
  reopenPhotoFile: vi.fn(() => undefined),
  discardPhotoFile: vi.fn(async () => {}),
  sweepPhotoFiles: vi.fn(async () => {}),
}));

vi.mock('@/notifications/applySchedule', () => ({
  applyScheduled: vi.fn(async () => {}),
}));

// Keep the real reconcile logic but spy on the desired-set builder.
vi.mock('@/notifications/scheduled', async (importActual) => {
  const actual = await importActual<typeof import('@/notifications/scheduled')>();
  return {
    ...actual,
    desiredScheduled: vi.fn(actual.desiredScheduled),
  };
});

const flush = () => new Promise((r) => setTimeout(r, 0));

// `hydrating` defaults to false: most tests want a store that already finished
// hydrating (the realistic state for a "then the user does X" scenario). The
// hydration-gating tests below override it to true to exercise the gate itself.
async function setup(opts: { hydrating?: boolean } = {}) {
  vi.resetModules();
  const { desiredScheduled } = await import('@/notifications/scheduled');
  const { applyScheduled } = await import('@/notifications/applySchedule');
  const { useAppStore } = await import('@/store/useAppStore');
  useAppStore.setState({ hydrating: opts.hydrating ?? false });
  const desired = vi.mocked(desiredScheduled);
  const apply = vi.mocked(applyScheduled);
  // Captured before initScheduledReminderSync's launch-time run, so callers can
  // measure exactly what THIS setup() produced. The mock factories above are
  // shared across every setup() call in this file (their call history is
  // cumulative, not reset per vi.resetModules()), so an absolute count would
  // silently include earlier tests' calls; see the `.at(-1)` note below.
  const appliesAtInit = apply.mock.calls.length;
  const buildsAtInit = desired.mock.calls.length;
  const { initScheduledReminderSync, reconcileNow } = await import('@/notifications/scheduleSync');
  initScheduledReminderSync();
  await flush();
  return { desired, apply, useAppStore, appliesAtInit, buildsAtInit, reconcileNow };
}

beforeEach(() => {
  mem.store.clear();
});

describe('initScheduledReminderSync gating', () => {
  it('does no rebuild on a bare tick', async () => {
    const { desired, apply, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    const applies = apply.mock.calls.length;

    useAppStore.setState({ now: useAppStore.getState().now + 1000 });
    await flush();

    expect(desired.mock.calls.length).toBe(builds);
    expect(apply.mock.calls.length).toBe(applies);
  });

  it('rebuilds when a gated slice changes (children)', async () => {
    const { desired, apply, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    const applies = apply.mock.calls.length;

    useAppStore.setState({
      children: [{ id: 'c1', first: 'Test', last: 'Kid', birth: Date.now(), color: '#fff' }],
    });
    await flush();

    expect(desired.mock.calls.length).toBe(builds + 1);
    expect(apply.mock.calls.length).toBe(applies + 1);
  });
});

describe('hydration gating (regression: launch must not reconcile pre-hydration state)', () => {
  it('does not reconcile at launch while the store is still hydrating', async () => {
    // Mirrors the real mount sequence: `hydrating` is still true (hydrate()'s
    // async work hasn't landed yet) when initScheduledReminderSync's
    // launch-time run fires.
    const { apply, appliesAtInit } = await setup({ hydrating: true });

    expect(apply.mock.calls.length).toBe(appliesAtInit);
  });

  it('does not reconcile a store change that lands mid-hydration', async () => {
    const { apply, appliesAtInit, useAppStore } = await setup({ hydrating: true });

    // hydrate() issues several separate set() calls before the one that
    // flips hydrating to false; this simulates one landing early.
    useAppStore.setState({
      children: [{ id: 'c1', first: 'Test', last: 'Kid', birth: Date.now(), color: '#fff' }],
    });
    await flush();

    expect(apply.mock.calls.length).toBe(appliesAtInit);
  });

  it('reconciles on the hydrating transition alone, with no other slice changing', async () => {
    // Isolates the subtlety: a set() that flips ONLY `hydrating` (nothing else
    // in the compared slice list changes) must still trigger a run. If
    // `hydrating` were left out of the slice comparison, this exact set()
    // would look like "nothing changed" and the post-hydration reconcile
    // would never happen.
    const { apply, appliesAtInit, useAppStore } = await setup({ hydrating: true });

    useAppStore.setState({ hydrating: false });
    await flush();

    expect(apply.mock.calls.length).toBe(appliesAtInit + 1);
  });

  it('reconciles with the real store content once hydration completes', async () => {
    const { apply, appliesAtInit, useAppStore } = await setup({ hydrating: true });
    const dueSoon = Date.now() + 14 * 24 * 60 * 60 * 1000; // comfortably in the future

    // The true-to-false hydrating transition, alongside the real children the
    // store hydrated with, must trigger exactly one reconcile.
    useAppStore.setState({
      hydrating: false,
      children: [{ id: 'c1', first: 'Due', last: 'Soon', birth: dueSoon, color: '#fff', expected: true }],
    });
    await flush();

    expect(apply.mock.calls.length).toBe(appliesAtInit + 1);
    const sent = apply.mock.calls.at(-1)?.[0] ?? [];
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.some((n) => n.identifier.startsWith('budkin:due:'))).toBe(true);
  });
});

describe('desired reminder flow (regression: a real reminder must reach applyScheduled)', () => {
  it('passes a non-empty desired set with a due-date identifier through to applyScheduled', async () => {
    const { apply, useAppStore } = await setup();
    const dueSoon = Date.now() + 14 * 24 * 60 * 60 * 1000; // comfortably in the future

    useAppStore.setState({
      children: [{ id: 'c1', first: 'Due', last: 'Soon', birth: dueSoon, color: '#fff', expected: true }],
    });
    await flush();

    const sent = apply.mock.calls.at(-1)?.[0] ?? [];
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.some((n) => n.identifier.startsWith('budkin:due:'))).toBe(true);
  });
});

describe('run serialization (concurrent store changes must not interleave OS calls)', () => {
  it('coalesces runs that arrive while one is in flight, to the latest state only', async () => {
    const { apply, desired, useAppStore } = await setup();
    const appliesBefore = apply.mock.calls.length;
    const buildsBefore = desired.mock.calls.length;

    // Hang the first run mid-flight, the way a real applyScheduled would sit
    // across several awaited native calls.
    let resolveFirst!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    apply.mockImplementationOnce(() => pending);

    useAppStore.setState({
      children: [{ id: 'c1', first: 'A', last: 'A', birth: Date.now(), color: '#fff' }],
    });
    await flush();
    expect(apply.mock.calls.length).toBe(appliesBefore + 1);
    expect(desired.mock.calls.length).toBe(buildsBefore + 1);

    // Two more changes land while that run is still in flight.
    useAppStore.setState({
      children: [{ id: 'c2', first: 'B', last: 'B', birth: Date.now(), color: '#fff' }],
    });
    useAppStore.setState({
      children: [{ id: 'c3', first: 'C', last: 'C', birth: Date.now(), color: '#fff' }],
    });
    await flush();

    // Neither triggered a new call: they were coalesced behind the busy run,
    // not interleaved with it.
    expect(apply.mock.calls.length).toBe(appliesBefore + 1);
    expect(desired.mock.calls.length).toBe(buildsBefore + 1);

    resolveFirst();
    await flush();
    await flush();

    // Exactly one follow-up run landed, built from c3 (the LATEST queued
    // state), never from the c2 state that arrived in between.
    expect(apply.mock.calls.length).toBe(appliesBefore + 2);
    expect(desired.mock.calls.length).toBe(buildsBefore + 2);
    const lastInput = desired.mock.calls.at(-1)?.[0];
    expect(lastInput?.children[0]?.id).toBe('c3');
  });
});

describe('reconcileNow (manual reconcile for call sites that touch no gated store slice)', () => {
  it('triggers a reconcile when called', async () => {
    const { apply, desired, reconcileNow } = await setup();
    const applies = apply.mock.calls.length;
    const builds = desired.mock.calls.length;

    reconcileNow();
    await flush();

    expect(apply.mock.calls.length).toBe(applies + 1);
    expect(desired.mock.calls.length).toBe(builds + 1);
  });

  it('does not reconcile while hydrating is true', async () => {
    const { apply, appliesAtInit, reconcileNow } = await setup({ hydrating: true });

    reconcileNow();
    await flush();

    expect(apply.mock.calls.length).toBe(appliesAtInit);
  });

  it('goes through the same coalescing latch as a store-driven run: two requests while one is in flight collapse to a single follow-up built from the latest state', async () => {
    const { apply, desired, useAppStore, reconcileNow } = await setup();
    const appliesBefore = apply.mock.calls.length;
    const buildsBefore = desired.mock.calls.length;

    // Hang the first run mid-flight, the way a real applyScheduled would sit
    // across several awaited native calls.
    let resolveFirst!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    apply.mockImplementationOnce(() => pending);

    reconcileNow();
    await flush();
    expect(apply.mock.calls.length).toBe(appliesBefore + 1);
    expect(desired.mock.calls.length).toBe(buildsBefore + 1);

    // The store changes (which on its own would also ask for a run via the
    // subscriber) and then reconcileNow is called again, both while the first
    // run is still in flight.
    useAppStore.setState({
      children: [{ id: 'cLatest', first: 'Latest', last: 'Latest', birth: Date.now(), color: '#fff' }],
    });
    reconcileNow();
    await flush();

    // Neither triggered a new call: both were coalesced behind the busy run,
    // not interleaved with it as a second concurrent read-then-write pass.
    expect(apply.mock.calls.length).toBe(appliesBefore + 1);
    expect(desired.mock.calls.length).toBe(buildsBefore + 1);

    resolveFirst();
    await flush();
    await flush();

    // Exactly one follow-up run landed, built from the latest state.
    expect(apply.mock.calls.length).toBe(appliesBefore + 2);
    expect(desired.mock.calls.length).toBe(buildsBefore + 2);
    const lastInput = desired.mock.calls.at(-1)?.[0];
    expect(lastInput?.children[0]?.id).toBe('cLatest');
  });
});

describe('toInput lastPumpAt derivation', () => {
  it('yields null when there are no pumping entries', async () => {
    const { desired } = await setup();

    expect(desired.mock.calls.at(-1)?.[0].lastPumpAt).toBeNull();
  });

  it('prefers end over start for a single pumping entry', async () => {
    const { desired, useAppStore } = await setup();

    useAppStore.setState({
      entries: [
        { id: 'p1', type: 'pumping', childId: 'c1', tags: [], start: 1000, end: 2000, amount: null },
      ],
    });
    await flush();

    const last = desired.mock.calls.at(-1)?.[0];
    expect(last?.lastPumpAt).toBe(2000);
  });

  it('derives lastPumpAt from the most recent pumping entry, ignoring non-pumping entries', async () => {
    const { desired, useAppStore } = await setup();

    useAppStore.setState({
      entries: [
        { id: 'p1', type: 'pumping', childId: 'c1', tags: [], start: 1000, end: 3000, amount: null },
        // No end yet (still running): falls back to start, which here is the most recent.
        { id: 'p2', type: 'pumping', childId: 'c1', tags: [], start: 10000, end: null, amount: null },
        // A far-future feeding entry must NOT be picked up as a pump.
        {
          id: 'f1',
          type: 'feeding',
          childId: 'c1',
          tags: [],
          start: 999999999,
          end: 999999999,
          feedType: 'breast',
          method: 'left',
          amount: null,
        },
      ],
    });
    await flush();

    const last = desired.mock.calls.at(-1)?.[0];
    expect(last?.lastPumpAt).toBe(10000);
  });
});

describe('nap anchor projection', () => {
  it('projects the latest ended sleep per child', async () => {
    const { desired, useAppStore } = await setup();
    useAppStore.setState({
      entries: [
        { id: 'e1', childId: 'c1', type: 'sleep', start: 1_000, end: 2_000, nap: true, tags: [] },
        { id: 'e2', childId: 'c1', type: 'sleep', start: 3_000, end: 4_000, nap: true, tags: [] },
        { id: 'e3', childId: 'c2', type: 'sleep', start: 5_000, end: 6_000, nap: true, tags: [] },
        // still running: no end, so it must not become an anchor
        { id: 'e4', childId: 'c1', type: 'sleep', start: 9_000, end: null, nap: true, tags: [] },
      ],
    });
    await flush();
    const input = desired.mock.calls.at(-1)?.[0];
    expect(input?.lastSleepEndByChild).toEqual({ c1: 4_000, c2: 6_000 });
  });

  it('projects children with an ongoing sleep entry into asleepChildIds', async () => {
    const { desired, useAppStore } = await setup();
    useAppStore.setState({
      entries: [
        // Ongoing, no matching Timer (e.g. edited to "still ongoing", or a
        // server record with no end): must still mark c1 asleep.
        { id: 'e1', childId: 'c1', type: 'sleep', start: 1_000, end: null, nap: true, tags: [] },
        // Ended: must NOT appear in asleepChildIds.
        { id: 'e2', childId: 'c2', type: 'sleep', start: 2_000, end: 3_000, nap: true, tags: [] },
      ],
    });
    await flush();
    const input = desired.mock.calls.at(-1)?.[0];
    expect(input?.asleepChildIds).toEqual({ c1: true });
  });

  it('reconciles when napSuggestions changes', async () => {
    const { desired, useAppStore } = await setup();
    await flush();
    const before = desired.mock.calls.length;
    useAppStore.getState().setReminderPref('napSuggestions', true);
    await flush();
    expect(desired.mock.calls.length).toBeGreaterThan(before);
  });

  it('does not reconcile when only the selected child changes', async () => {
    // Nothing in the desired set reads the selection as of 0.15.2: treatment
    // reminders cover every child and the milestone catch-up nudge loops them,
    // so a switch cannot change what Android should hold. The justification for
    // the old entry was the two rules that did read it; both are gone, and the
    // even older one (an ownerless sleep timer resolving to
    // `timer.childId ?? selectedChildId`) was retired before that.
    const { desired, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    useAppStore.setState({ selectedChildId: 'c2' });
    await flush();
    expect(desired.mock.calls.length).toBe(builds);
  });
});

describe('nap suggestion end-to-end (regression: toInput\'s key space (e.childId) and napReminders\' lookup key (child.id) are aligned only by inspection)', () => {
  // `desiredScheduled` above is a spy wrapping the REAL implementation
  // (`vi.fn(actual.desiredScheduled)`), so this exercises the genuine
  // toInput -> napReminders handoff end to end, not a mock of it.
  it('carries a real kind: "nap" reminder through to applyScheduled', async () => {
    // Fake ONLY Date, so `flush`'s real setTimeout still resolves. Date.now()
    // (what `run()` in scheduleSync.ts uses as `now`) becomes deterministic,
    // so the fire-time arithmetic below is robust to whatever wall-clock time
    // the suite actually runs at.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const fixedNow = new Date(2026, 6, 15, 10, 0, 0).getTime(); // 10:00 local, well inside quiet hours
      vi.setSystemTime(fixedNow);

      const { apply, useAppStore } = await setup();

      // 60 days old: wakeWindowBand's 90-day bucket applies (hi: 90), so the
      // nudge fires 90 - NAP_LEAD_MIN(15) = 75 minutes after waking.
      const birth = fixedNow - 60 * 24 * 60 * 60 * 1000;
      // Woke 10 minutes before "now": fire = woke + 75min = now + 65min, i.e.
      // 11:05 local — in the future and inside 07:00-19:00 quiet hours.
      const woke = fixedNow - 10 * 60 * 1000;

      useAppStore.setState({
        napSuggestions: true,
        children: [{ id: 'c1', first: 'Rowan', last: '', birth, color: '#208AEF' }],
        entries: [
          {
            id: 'e1',
            childId: 'c1',
            type: 'sleep',
            start: woke - 60 * 60 * 1000,
            end: woke,
            nap: true,
            tags: [],
          },
        ],
      });
      await flush();

      const sent = apply.mock.calls.at(-1)?.[0] ?? [];
      const nap = sent.find((n) => n.kind === 'nap');
      expect(nap).toBeDefined();
      expect(nap?.fireAt).toBe(woke + 75 * 60_000);
      expect(nap?.fireAt).toBeGreaterThan(fixedNow);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('treatment projection', () => {
  const treatmentRec: Treatment = {
    id: 'treatment1',
    childId: 'c1',
    name: 'Omeprazol',
    scheduleMode: 'timesOfDay',
    timesOfDay: ['morning'],
    fromDate: new Date(2020, 0, 1).getTime(),
    active: true,
  };

  const dose = (childId: string, time: number): Entry => ({
    id: `m-${time}`,
    childId,
    type: 'medication',
    name: 'Omeprazol',
    time,
    // `tags` is required on EntryBase; omitting it is a type error, not an
    // inferred default.
    tags: [],
  });

  it('projects treatments and per-treatment dose scalars', async () => {
    const { desired, useAppStore } = await setup();
    const doseAt = Date.now() - 60_000;
    useAppStore.setState({ selectedChildId: 'c1', treatments: [treatmentRec], entries: [dose('c1', doseAt)] });
    await flush();

    const input = desired.mock.calls.at(-1)![0];
    expect(input.treatments).toEqual([treatmentRec]);
    expect(input.treatmentDoses.treatment1.lastAt).toBe(doseAt);
  });

  it("scopes each treatment's doses to that treatment's own child", async () => {
    const { desired, useAppStore } = await setup();
    useAppStore.setState({
      selectedChildId: 'c1',
      treatments: [treatmentRec],
      entries: [dose('c2', Date.now() - 60_000)],
    });
    await flush();

    // The dose belongs to another child, so it cannot count toward a c1 treatment.
    expect(desired.mock.calls.at(-1)![0].treatmentDoses.treatment1).toEqual({ today: 0, lastAt: null });
  });

  it("gives a non-selected child's treatment its own scalars", async () => {
    // The point of the whole change. Until now only the selected child's
    // treatments got a key at all, so a sibling's regimen was invisible here.
    const { desired, useAppStore } = await setup();
    const doseAt = Date.now() - 60_000;
    useAppStore.setState({
      selectedChildId: 'c1',
      treatments: [treatmentRec, { ...treatmentRec, id: 'treatment2', childId: 'c2' }],
      entries: [dose('c2', doseAt)],
    });
    await flush();

    const input = desired.mock.calls.at(-1)![0];
    expect(input.treatmentDoses.treatment2).toEqual({ today: 1, lastAt: doseAt });
  });

  it('does not let one child\'s dose settle a sibling\'s identically named treatment', async () => {
    // The hazard this task exists to avoid. Dose-to-treatment attribution is by
    // NAME (a MedicationEntry carries no treatment reference that survives
    // sync), and two children on the same medicine is the ordinary case. Handing
    // `treatmentDoseScalars` both children's treatments and both children's
    // entries at once would cross-attribute silently.
    const { desired, useAppStore } = await setup();
    const doseAt = Date.now() - 60_000;
    useAppStore.setState({
      selectedChildId: 'c1',
      treatments: [treatmentRec, { ...treatmentRec, id: 'treatment2', childId: 'c2' }],
      entries: [dose('c1', doseAt)],
    });
    await flush();

    const input = desired.mock.calls.at(-1)![0];
    expect(input.treatmentDoses.treatment1).toEqual({ today: 1, lastAt: doseAt });
    expect(input.treatmentDoses.treatment2).toEqual({ today: 0, lastAt: null });
  });

  it('rebuilds when the treatments list changes', async () => {
    const { desired, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    useAppStore.setState({ treatments: [treatmentRec] });
    await flush();
    expect(desired.mock.calls.length).toBeGreaterThan(builds);
  });

  it('rebuilds when the treatments pref is toggled', async () => {
    const { desired, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    useAppStore.setState({ treatmentReminders: false });
    await flush();
    expect(desired.mock.calls.length).toBeGreaterThan(builds);
  });

  it('rebuilds when the treatments resync stamp moves', async () => {
    const { desired, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    useAppStore.setState({ treatmentRemindersEnabledAt: Date.now() });
    await flush();
    expect(desired.mock.calls.length).toBeGreaterThan(builds);
  });
});

describe('delivered-sweep projection', () => {
  it('hands applyScheduled the SAME projection it built the desired set from', async () => {
    // The reconciler's delivered-notification sweep answers its staleness
    // questions from this projection. Rebuilding it there, or passing a second
    // `now`, would let the two halves of one reconcile straddle local midnight
    // and disagree about what "today" means.
    const { apply, desired, useAppStore } = await setup();
    useAppStore.setState({
      children: [{ id: 'c1', first: 'Rowan', last: '', birth: Date.now() - 86_400_000, color: '#208AEF' }],
    });
    await flush();

    const built = desired.mock.calls.at(-1)!;
    const applied = apply.mock.calls.at(-1)!;
    expect(applied[1]).toBe(built[0]);
    expect(applied[2]).toBe(built[1]);
  });
});
