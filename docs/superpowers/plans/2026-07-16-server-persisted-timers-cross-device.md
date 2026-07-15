# Server-persisted timers across devices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror a running timer to the user's Baby Buddy instance so a timer started on one device is visible and stoppable from another device signed into the same account.

**Architecture:** The BB `/api/timers/` record is a server mirror of the local running timer. Create on start, PATCH on edit, DELETE on stop/discard; the entry commit stays fully local through the existing offline-first path. Structural fields plus `amount` are encoded into the timer's `name`; `child` and `start` ride natively. Devices pull and reconcile server timers on the sync moments already in place (foreground, pull-to-refresh, reconnect). Reuses the existing `serverId` + `pendingOps` machinery.

**Tech Stack:** TypeScript, React Native / Expo SDK 56, Zustand store, Baby Buddy DRF REST API (token auth), Vitest.

## Global Constraints

- Same-account/multi-device only. Cross-caregiver (different accounts) is out of scope.
- Structural fields carried: `saveAs`, `feedType`, `method`, `startSide`, `nap`, `amount`. NOT carried: freeform `notes`, `tags`, and the tummy `milestone` text (freeform → device-local).
- No em-dashes in prose, comments, or UI copy. Use commas, colons, or separate sentences.
- Follow existing patterns in `src/api/client.ts`, `src/data/repository.ts`, `src/store/useAppStore.ts`. No new dependencies.
- Freshness is "on focus / refresh" only. No polling loop.
- Timers are epoch-ms internally; the client layer converts to/from ISO 8601 (`toISO`/`fromISO`).

---

### Task 1: Extend the `Timer` model with `serverId` and `childId`

**Files:**
- Modify: `src/types/models.ts` (Timer interface, ~183-209)
- Modify: `src/store/useAppStore.ts` (`startQuickTimer` ~1799; `save` live-interval path ~1717-1724; `stopTimer` ~1811-1821)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Produces: `Timer.serverId?: number`, `Timer.childId?: string`. `serverId == null` means "not on server yet". `childId` is the local child id the timer belongs to (falls back to the selected child for pre-existing persisted timers).

- [ ] **Step 1: Write the failing test**

Add to `src/store/useAppStore.test.ts`:

```ts
it('stamps childId on a quick-started timer and commits the stop to that child', () => {
  useAppStore.setState({
    connection: { mode: 'local' },
    children: [{ id: 'c1', first: 'A', last: '', birth: 0, color: '#fff' }],
    selectedChildId: 'c1',
    timers: [],
    entries: [],
  });
  useAppStore.getState().startQuickTimer();
  const timer = useAppStore.getState().timers[0];
  expect(timer.childId).toBe('c1');

  // switch child, then stop: the entry must go to the timer's child, not the newly selected one
  useAppStore.setState({ selectedChildId: 'c2' });
  useAppStore.getState().stopTimer(timer.id);
  expect(useAppStore.getState().entries[0].childId).toBe('c1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/useAppStore.test.ts -t 'stamps childId'`
Expected: FAIL (`timer.childId` is `undefined`).

- [ ] **Step 3: Add the fields and stamp them**

In `src/types/models.ts`, inside `interface Timer`, add after `id: string;`:

```ts
  /** server numeric id; present once the timer is mirrored to a server */
  serverId?: number;
  /** local child id this timer belongs to (defaults to the selected child) */
  childId?: string;
```

In `src/store/useAppStore.ts` `startQuickTimer`, add `childId` to the timer literal:

```ts
    const timer: Timer = {
      id: 't' + Date.now(),
      activity: 'feeding',
      name: ACTIVITY_LABEL.feeding,
      start: Date.now(),
      saveAs: 'feeding',
      childId: s.selectedChildId,
    };
```

In the `save` live-interval path (~1718), add `childId`:

```ts
      const timer: Timer = {
        id: 't' + Date.now(),
        activity: type,
        name: ACTIVITY_LABEL[type],
        start: teStart(te, now) as number,
        saveAs: type,
        childId,
      };
```

In `stopTimer`, replace the child used to build the entry. Change:

```ts
    const base = { id: 'e' + now, childId: s.selectedChildId, tags: savedTags, notes: tm.notes };
```
to:
```ts
    const childId = tm.childId ?? s.selectedChildId;
    const base = { id: 'e' + now, childId, tags: savedTags, notes: tm.notes };
```
Then change the sleep branch `buildSleepEntry(tm, resolvedEnd, s.selectedChildId)` to `buildSleepEntry(tm, resolvedEnd, childId)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/useAppStore.test.ts -t 'stamps childId'`
Expected: PASS

- [ ] **Step 5: Run the full store + type check**

Run: `npx vitest run src/store/useAppStore.test.ts && npx tsc --noEmit`
Expected: PASS (no type errors)

- [ ] **Step 6: Commit**

```bash
git add src/types/models.ts src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(timers): add serverId + childId to the Timer model"
```

---

### Task 2: Pure encode/decode/reconstruct module

**Files:**
- Create: `src/data/serverTimers.ts`
- Test: `src/data/serverTimers.test.ts`

**Interfaces:**
- Consumes: `Timer` (Task 1); `ACTIVITY_LABEL` from `@/lib/activities`.
- Produces:
  - `encodeTimerName(t: Timer): string`
  - `decodeTimerName(name: string): DecodedTimer` where `DecodedTimer = { saveAs: ActivityType; feedType?: FeedType; method?: FeedMethod; startSide?: 'left' | 'right'; amount?: number; nap?: boolean }`
  - `serverTimerToTimer(raw: { id: number; name: string; start: number }, childId: string): Timer`

- [ ] **Step 1: Write the failing test**

Create `src/data/serverTimers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { decodeTimerName, encodeTimerName, serverTimerToTimer } from '@/data/serverTimers';
import type { Timer } from '@/types/models';

const base = (over: Partial<Timer>): Timer => ({ id: 't1', activity: 'feeding', name: 'Feeding', start: 0, saveAs: 'feeding', ...over });

describe('encode/decode timer name', () => {
  it('round-trips a feeding timer with structural fields + amount', () => {
    const t = base({ saveAs: 'feeding', feedType: 'formula', method: 'bottle', amount: 90 });
    const name = encodeTimerName(t);
    expect(name).toBe('Feeding · v1 · ft:formula · m:bottle · amt:90');
    const d = decodeTimerName(name);
    expect(d).toMatchObject({ saveAs: 'feeding', feedType: 'formula', method: 'bottle', amount: 90 });
  });

  it('carries the breastfeeding start side', () => {
    const t = base({ saveAs: 'feeding', feedType: 'breast', method: 'both', startSide: 'right' });
    expect(decodeTimerName(encodeTimerName(t))).toMatchObject({ method: 'both', startSide: 'right' });
  });

  it('encodes the nap flag only when true', () => {
    expect(encodeTimerName(base({ saveAs: 'sleep', nap: true }))).toBe('Sleep · v1 · nap');
    expect(encodeTimerName(base({ saveAs: 'sleep', nap: false }))).toBe('Sleep · v1');
    expect(decodeTimerName('Sleep · v1 · nap')).toMatchObject({ saveAs: 'sleep', nap: true });
    expect(decodeTimerName('Sleep · v1').nap).toBeUndefined();
  });

  it('falls back to a generic feeding timer for a foreign/unmarked name', () => {
    expect(decodeTimerName('Kitchen nap timer')).toMatchObject({ saveAs: 'feeding' });
  });

  it('reconstructs a Timer from a server record', () => {
    const t = serverTimerToTimer({ id: 7, name: 'Sleep · v1 · nap', start: 1000 }, 'c1');
    expect(t).toMatchObject({ id: 'tsrv7', serverId: 7, childId: 'c1', saveAs: 'sleep', nap: true, start: 1000, name: 'Sleep' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/serverTimers.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the module**

Create `src/data/serverTimers.ts`:

```ts
/**
 * Serialize a running Timer's structural fields into (and out of) the one
 * free-form field a Baby Buddy timer exposes: `name`. `child` and `start` ride
 * natively on the BB timer, so `name` carries only the fields that shape the
 * committed entry: saveAs (as the leading human label), feed type, method,
 * start side, nap flag, and amount. Freeform notes/tags and the tummy milestone
 * text are deliberately NOT carried; they stay on the device where they were
 * typed. The `v1` marker after the label versions the grammar and doubles as
 * the "made by Budkin" signal: a name without it (e.g. a timer created in Baby
 * Buddy's own UI) decodes to a generic feeding timer that is still stoppable.
 */
import { ACTIVITY_LABEL } from '@/lib/activities';
import type { ActivityType, FeedMethod, FeedType, Timer } from '@/types/models';

const SEP = ' · ';
const VERSION = 'v1';

// Reverse of ACTIVITY_LABEL, built once: display label -> saveAs activity.
const LABEL_TO_ACTIVITY: Record<string, ActivityType> = Object.fromEntries(
  (Object.entries(ACTIVITY_LABEL) as [ActivityType, string][]).map(([k, v]) => [v, k]),
) as Record<string, ActivityType>;

export interface DecodedTimer {
  saveAs: ActivityType;
  feedType?: FeedType;
  method?: FeedMethod;
  startSide?: 'left' | 'right';
  amount?: number;
  nap?: boolean;
}

export function encodeTimerName(t: Timer): string {
  const toks: string[] = [VERSION];
  if (t.saveAs === 'feeding') {
    if (t.feedType) toks.push(`ft:${t.feedType}`);
    if (t.method) toks.push(`m:${t.method}`);
    if (t.startSide) toks.push(`s:${t.startSide}`);
    if (t.amount != null) toks.push(`amt:${t.amount}`);
  } else if (t.saveAs === 'pumping') {
    if (t.method) toks.push(`m:${t.method}`);
    if (t.amount != null) toks.push(`amt:${t.amount}`);
  } else if (t.saveAs === 'sleep') {
    if (t.nap === true) toks.push('nap');
  }
  return `${ACTIVITY_LABEL[t.saveAs]}${SEP}${toks.join(SEP)}`;
}

export function decodeTimerName(name: string): DecodedTimer {
  const parts = name.split(SEP);
  const label = parts[0] ?? '';
  const saveAs = LABEL_TO_ACTIVITY[label] ?? 'feeding';
  // No version marker => foreign timer (e.g. made in Baby Buddy's own UI).
  if (parts[1] !== VERSION) return { saveAs };
  const d: DecodedTimer = { saveAs };
  for (const tok of parts.slice(2)) {
    if (tok === 'nap') d.nap = true;
    else if (tok.startsWith('ft:')) d.feedType = tok.slice(3) as FeedType;
    else if (tok.startsWith('m:')) d.method = tok.slice(2) as FeedMethod;
    else if (tok.startsWith('s:')) d.startSide = tok.slice(2) as 'left' | 'right';
    else if (tok.startsWith('amt:')) {
      const n = Number(tok.slice(4));
      if (Number.isFinite(n)) d.amount = n;
    }
  }
  return d;
}

/** Reconstruct a local Timer from a server timer record (start already in ms). */
export function serverTimerToTimer(raw: { id: number; name: string; start: number }, childId: string): Timer {
  const d = decodeTimerName(raw.name);
  return {
    id: `tsrv${raw.id}`,
    serverId: raw.id,
    childId,
    activity: d.saveAs,
    saveAs: d.saveAs,
    name: ACTIVITY_LABEL[d.saveAs],
    start: raw.start,
    feedType: d.feedType,
    method: d.method,
    startSide: d.startSide,
    amount: d.amount,
    nap: d.nap,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/serverTimers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/serverTimers.ts src/data/serverTimers.test.ts
git commit -m "feat(timers): encode/decode timer structural fields in the BB name"
```

---

### Task 3: Pure reconcile function

**Files:**
- Modify: `src/data/serverTimers.ts`
- Test: `src/data/serverTimers.test.ts`

**Interfaces:**
- Produces: `reconcileTimers(local: Timer[], server: Timer[]): Timer[]`
  - Local `serverId == null` timers are kept (pending push).
  - Local timers with a `serverId` still present in `server` are kept but refreshed from the server copy (structural fields + `start`), preserving local-only `notes`/`tags`.
  - Local timers with a `serverId` absent from `server` are dropped (stopped/discarded elsewhere).
  - Server timers not matched to any local `serverId` are added.

- [ ] **Step 1: Write the failing test**

Add to `src/data/serverTimers.test.ts`:

```ts
import { reconcileTimers } from '@/data/serverTimers';

describe('reconcileTimers', () => {
  const srv = (id: number, over: Partial<Timer> = {}): Timer =>
    ({ id: `tsrv${id}`, serverId: id, childId: 'c1', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: 0, ...over });

  it('keeps unsynced local timers (serverId == null)', () => {
    const local: Timer[] = [{ id: 't-local', activity: 'feeding', saveAs: 'feeding', name: 'Feeding', start: 5 }];
    expect(reconcileTimers(local, [])).toEqual(local);
  });

  it('drops a synced local timer that is gone from the server', () => {
    const local = [srv(1)];
    expect(reconcileTimers(local, [])).toEqual([]);
  });

  it('refreshes a matched timer from the server but preserves local notes/tags', () => {
    const local = [srv(1, { id: 't-keep', nap: false, notes: 'mine', tags: ['x'], start: 100 })];
    const server = [srv(1, { nap: true, start: 200 })];
    const out = reconcileTimers(local, server);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 't-keep', nap: true, start: 200, notes: 'mine', tags: ['x'] });
  });

  it('adds a server timer with no local match', () => {
    const out = reconcileTimers([], [srv(9)]);
    expect(out).toEqual([srv(9)]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/serverTimers.test.ts -t reconcileTimers`
Expected: FAIL (`reconcileTimers` not exported).

- [ ] **Step 3: Implement `reconcileTimers`**

Append to `src/data/serverTimers.ts`:

```ts
/**
 * Merge the device's local running timers with the server's. Same-account cross
 * device: the server is authoritative for timers that carry a serverId, but
 * local-only fields (notes/tags, never sent to the server) and not-yet-pushed
 * local timers (serverId == null) are preserved.
 */
export function reconcileTimers(local: Timer[], server: Timer[]): Timer[] {
  const serverById = new Map<number, Timer>();
  for (const t of server) if (t.serverId != null) serverById.set(t.serverId, t);

  const out: Timer[] = [];
  const matched = new Set<number>();
  for (const l of local) {
    if (l.serverId == null) {
      out.push(l); // pending push
      continue;
    }
    const s = serverById.get(l.serverId);
    if (!s) continue; // stopped/discarded elsewhere
    matched.add(l.serverId);
    // Server wins for structural fields + start; local notes/tags are preserved.
    out.push({ ...s, id: l.id, notes: l.notes, tags: l.tags });
  }
  for (const s of server) {
    if (s.serverId != null && !matched.has(s.serverId)) out.push(s);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/serverTimers.test.ts`
Expected: PASS (all serverTimers tests)

- [ ] **Step 5: Commit**

```bash
git add src/data/serverTimers.ts src/data/serverTimers.test.ts
git commit -m "feat(timers): reconcile local + server timers (server authoritative, local notes preserved)"
```

---

### Task 4: Baby Buddy client timer methods

**Files:**
- Modify: `src/api/client.ts` (add `ServerTimer` interface + four methods on `BabybuddyClient`)
- Test: `src/api/client.test.ts`

**Interfaces:**
- Produces on `BabybuddyClient`:
  - `listTimers(limit?: number): Promise<ServerTimer[]>` where `ServerTimer = { id: number; child: number | null; name: string; start: number }` (`start` in ms)
  - `createTimer(childServerId: number, startMs: number, name: string): Promise<number | undefined>`
  - `updateTimer(id: number, name: string, startMs: number): Promise<void>` (PATCH name + start)
  - `deleteTimer(id: number): Promise<void>`

- [ ] **Step 1: Write the failing test**

Add to `src/api/client.test.ts` (follow the file's existing fetch-mock style; this shows the shape, adapt to the local `mockFetch` helper already in that file):

```ts
describe('timers', () => {
  it('lists timers, converting start to ms', async () => {
    const fetchMock = mockJson({ count: 1, next: null, previous: null, results: [{ id: 4, child: 2, name: 'Sleep · v1 · nap', start: '2026-07-16T10:00:00Z' }] });
    const c = new BabybuddyClient('https://bb.test', 'tok');
    const timers = await c.listTimers();
    expect(timers).toEqual([{ id: 4, child: 2, name: 'Sleep · v1 · nap', start: Date.parse('2026-07-16T10:00:00Z') }]);
    expect(fetchMock).toHaveBeenCalledWith('https://bb.test/api/timers/?limit=100', expect.anything());
  });

  it('creates a timer with child, start, name', async () => {
    const fetchMock = mockJson({ id: 11 });
    const c = new BabybuddyClient('https://bb.test', 'tok');
    const id = await c.createTimer(2, Date.parse('2026-07-16T10:00:00Z'), 'Feeding · v1');
    expect(id).toBe(11);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ child: 2, start: '2026-07-16T10:00:00.000Z', name: 'Feeding · v1' });
  });

  it('deletes a timer', async () => {
    const fetchMock = mockNoContent();
    const c = new BabybuddyClient('https://bb.test', 'tok');
    await c.deleteTimer(11);
    expect(fetchMock).toHaveBeenCalledWith('https://bb.test/api/timers/11/', expect.objectContaining({ method: 'DELETE' }));
  });
});
```

Note: use whatever mock helpers `client.test.ts` already defines (inspect the top of that file). If the helpers are named differently, adapt these three tests to them; the assertions (URL, method, JSON body) are what matter.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/client.test.ts -t timers`
Expected: FAIL (`listTimers` not a function).

- [ ] **Step 3: Implement the methods**

In `src/api/client.ts`, add the interface near `Paginated` (after line 51):

```ts
export interface ServerTimer {
  id: number;
  child: number | null;
  name: string;
  /** start, epoch ms (converted from the API's ISO string) */
  start: number;
}
```

Add these methods inside `class BabybuddyClient` (e.g. after `deleteMeasurement`, before the closing brace at line 700):

```ts
  // ---- running timers (/api/timers/) ----

  /** List the connected user's running timers. */
  async listTimers(limit = 100): Promise<ServerTimer[]> {
    const data = await this.request<Paginated<any>>(`/timers/?limit=${limit}`);
    return data.results.map((t) => ({
      id: t.id,
      child: t.child ?? null,
      name: t.name ?? '',
      start: fromISO(t.start),
    }));
  }

  /** Create a timer for a child; returns its new server id. */
  async createTimer(childServerId: number, startMs: number, name: string): Promise<number | undefined> {
    const res = await this.request<{ id?: number }>('/timers/', {
      method: 'POST',
      body: JSON.stringify({ child: childServerId, start: toISO(startMs), name }),
    });
    return res?.id;
  }

  /** Update a timer's encoded name and start. */
  async updateTimer(id: number, name: string, startMs: number): Promise<void> {
    await this.request(`/timers/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ name, start: toISO(startMs) }),
    });
  }

  /** Delete a timer on the server. */
  async deleteTimer(id: number): Promise<void> {
    await this.request(`/timers/${id}/`, { method: 'DELETE' });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/client.test.ts -t timers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/client.ts src/api/client.test.ts
git commit -m "feat(timers): BabybuddyClient list/create/update/delete timer methods"
```

---

### Task 5: Repository wrappers + populate `loadFromServer` timers

**Files:**
- Modify: `src/data/repository.ts`
- Test: `src/data/repository.test.ts` (follow existing style; if the file mocks `BabybuddyClient`, extend that mock)

**Interfaces:**
- Consumes: `encodeTimerName`, `serverTimerToTimer` (Task 2); client methods (Task 4).
- Produces:
  - `pushTimerToServer(conn: Connection, timer: Timer, childServerId: number): Promise<number | undefined>`
  - `updateTimerOnServer(conn: Connection, timer: Timer): Promise<void>` (no-op unless `timer.serverId != null`)
  - `deleteTimerFromServer(conn: Connection, serverId: number): Promise<void>`
  - `loadFromServer` now returns real `timers` (reconstructed, child-mapped), instead of `[]`.

- [ ] **Step 1: Write the failing test**

Add to `src/data/repository.test.ts` a test that `loadFromServer` maps server timers onto local children. Mirror how the file already mocks the client. Example shape:

```ts
it('loadFromServer reconstructs timers and maps the child FK to a local id', async () => {
  // Arrange the BabybuddyClient mock so listChildren -> [{id:2,...}] (local id '2', serverId 2)
  // and listTimers -> [{ id: 4, child: 2, name: 'Sleep · v1 · nap', start: 1000 }].
  const result = await loadFromServer({ mode: 'server', serverUrl: 'https://bb.test', token: 't' });
  expect(result.timers).toEqual([
    expect.objectContaining({ serverId: 4, childId: '2', saveAs: 'sleep', nap: true, start: 1000 }),
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/repository.test.ts -t 'reconstructs timers'`
Expected: FAIL (timers is `[]`).

- [ ] **Step 3: Implement**

In `src/data/repository.ts`, import the pure helpers at the top:

```ts
import { encodeTimerName, serverTimerToTimer } from '@/data/serverTimers';
```

In `loadFromServer`, after `const children = await client.listChildren();` and before the `return`, build timers:

```ts
  let timers: Timer[] = [];
  try {
    const raw = await client.listTimers();
    const childByServerId = new Map<number, string>();
    for (const c of children) if (c.serverId != null) childByServerId.set(c.serverId, c.id);
    timers = raw.flatMap((t) => {
      if (t.child == null) return [];
      const childId = childByServerId.get(t.child);
      return childId ? [serverTimerToTimer(t, childId)] : [];
    });
  } catch {
    timers = [];
  }
```

Change the final `return { children, entries, timers: [], selectedChildId, lastFeed, measurements };` to use `timers`.

Add the three wrappers near `pushEntryToServer` (mirror its guard style):

```ts
/** Create a running timer on the server; returns its new server id. Requires the
 *  child's server id (skip when the child isn't synced yet). */
export async function pushTimerToServer(conn: Connection, timer: Timer, childServerId: number): Promise<number | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createTimer(childServerId, timer.start, encodeTimerName(timer));
}

/** Update a running timer's encoded name + start on the server (needs serverId). */
export async function updateTimerOnServer(conn: Connection, timer: Timer): Promise<void> {
  if (conn.mode !== 'server' || timer.serverId == null) return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.updateTimer(timer.serverId, encodeTimerName(timer), timer.start);
}

/** Delete a running timer on the server. */
export async function deleteTimerFromServer(conn: Connection, serverId: number): Promise<void> {
  if (conn.mode !== 'server') return;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  await client.deleteTimer(serverId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/repository.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/repository.ts src/data/repository.test.ts
git commit -m "feat(timers): repository timer push/update/delete + loadFromServer reconstruction"
```

---

### Task 6: pendingOps timer variants

**Files:**
- Modify: `src/data/pendingOps.ts` (PendingOp union)
- Test: `src/data/pendingOps.test.ts`

**Interfaces:**
- Produces two new `PendingOp` members:
  - `{ op: 'update'; entity: 'timer'; payload: Timer }`
  - `{ op: 'delete'; entity: 'timer'; serverId: number }`

- [ ] **Step 1: Write the failing test**

Add to `src/data/pendingOps.test.ts`:

```ts
it('round-trips timer update and delete ops', async () => {
  const timer = { id: 't1', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: 0, serverId: 5 } as const;
  await addPendingOp({ op: 'update', entity: 'timer', payload: timer });
  await addPendingOp({ op: 'delete', entity: 'timer', serverId: 9 });
  const ops = await loadPendingOps();
  expect(ops).toEqual([
    { op: 'update', entity: 'timer', payload: timer },
    { op: 'delete', entity: 'timer', serverId: 9 },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/pendingOps.test.ts -t 'timer update and delete'`
Expected: FAIL (type error / the union does not allow `entity: 'timer'`). If Vitest runs JS without type-checking, the runtime round-trip passes but `npx tsc --noEmit` fails; run tsc to see the failure.

- [ ] **Step 3: Implement**

In `src/data/pendingOps.ts`, add `Timer` to the type import and extend the union:

```ts
import type { ActivityType, Child, Entry, Measurement, MeasurementKind, Timer } from '@/types/models';

export type PendingOp =
  | { op: 'update'; entity: 'child'; payload: Child }
  | { op: 'update'; entity: 'measurement'; payload: Measurement }
  | { op: 'update'; entity: 'entry'; payload: Entry }
  | { op: 'update'; entity: 'timer'; payload: Timer }
  | { op: 'delete'; entity: 'entry'; entryType: ActivityType; serverId: number }
  | { op: 'delete'; entity: 'measurement'; kind: MeasurementKind; serverId: number }
  | { op: 'delete'; entity: 'timer'; serverId: number };
```

- [ ] **Step 4: Run test + tsc to verify pass**

Run: `npx vitest run src/data/pendingOps.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/pendingOps.ts src/data/pendingOps.test.ts
git commit -m "feat(timers): pendingOps timer update/delete variants"
```

---

### Task 7: Store — mirror timer CREATE on start

**Files:**
- Modify: `src/store/useAppStore.ts` (imports; `startQuickTimer`; `save` live-interval path; a new module helper)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `pushTimerToServer`, `deleteTimerFromServer` (Task 5).
- Produces: module helper `mirrorTimerCreate(get, set, timerId)` — for the timer with `timerId`, when online + server mode and its child has a `serverId`, POST it and stamp `serverId`; if the timer is gone by the time the POST resolves (start-then-immediately-stop race), DELETE the just-created server timer. Offline or child-unsynced: leave `serverId == null` (reconnect flush handles it in Task 10).

- [ ] **Step 1: Write the failing test**

Add to `src/store/useAppStore.test.ts` (use the file's existing server-connection + fetch-mock harness; shape shown):

```ts
it('POSTs a new timer and stamps its serverId when online', async () => {
  // connect to a server with child c1 (serverId 2); mock createTimer -> id 11
  useAppStore.getState().startQuickTimer();
  const id = useAppStore.getState().timers[0].id;
  await flushMicrotasks(); // let the background POST resolve
  expect(useAppStore.getState().timers.find((t) => t.id === id)?.serverId).toBe(11);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/useAppStore.test.ts -t 'POSTs a new timer'`
Expected: FAIL (serverId stays undefined).

- [ ] **Step 3: Implement**

In `src/store/useAppStore.ts`, add to the `@/data/repository` import list: `deleteTimerFromServer`, `pushTimerToServer`, `updateTimerOnServer`. Add a module-level helper near `buildUploadDeps` (~356):

```ts
/** Mirror a freshly-created local timer to the server (create + stamp serverId),
 *  reusing the offline-first optimistic pattern. No-op unless online + server
 *  mode and the timer's child is already synced. If the timer was stopped or
 *  discarded before the POST resolved (serverId never landed locally), delete
 *  the orphan that the POST created. */
function mirrorTimerCreate(
  get: () => AppStore,
  set: (partial: Partial<AppState> | ((s: AppStore) => Partial<AppState>)) => void,
  timerId: string,
): void {
  const s = get();
  const conn = s.connection;
  if (!conn || conn.mode !== 'server' || s.offline) return;
  const timer = s.timers.find((t) => t.id === timerId);
  if (!timer) return;
  const child = s.children.find((c) => c.id === (timer.childId ?? s.selectedChildId));
  if (!child || child.serverId == null) return; // child not synced yet -> reconnect flush handles it
  void pushTimerToServer(conn, timer, child.serverId)
    .then((serverId) => {
      if (serverId == null) return;
      const stillHere = get().timers.some((t) => t.id === timerId);
      if (stillHere) {
        set((st) => ({ timers: st.timers.map((t) => (t.id === timerId ? { ...t, serverId } : t)) }));
      } else {
        // Stopped/discarded during the POST: clean up the orphan.
        void deleteTimerFromServer(conn, serverId).catch(() => {});
      }
    })
    .catch(() => {});
}
```

At the end of `startQuickTimer`, after `set({ timers: [...s.timers, timer] });`, add:

```ts
    mirrorTimerCreate(get, set, timer.id);
```

In the `save` live-interval path, after the `set({ timers: [...], sheet: null, fromTimerId: null });` (~1725), add:

```ts
      mirrorTimerCreate(get, set, timer.id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/useAppStore.test.ts -t 'POSTs a new timer' && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(timers): mirror timer creation to the server with orphan cleanup"
```

---

### Task 8: Store — mirror timer EDITS

**Files:**
- Modify: `src/store/useAppStore.ts` (`saveTimerDetails`, `setTimerSaveAs`, `adjustTimerStart`, `setTimerStart`; new module helper)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `updateTimerOnServer` (Task 5); `addPendingOp` (already imported).
- Produces: module helper `mirrorTimerEdit(get, timer)` — if `timer.serverId != null`: online → PATCH name+start; offline → enqueue `{ op:'update', entity:'timer', payload: timer }`. If `serverId == null`: no-op (the eventual create encodes the current fields).

- [ ] **Step 1: Write the failing test**

```ts
it('PATCHes a synced timer when its details are edited online', async () => {
  // start a timer, let it sync (serverId 11). Open its editor and saveTimerDetails with nap on.
  // Assert updateTimer was called (spy on the client / fetch) with the re-encoded name.
});
it('queues a timer update op when edited offline', async () => {
  // with offline:true and a synced timer, edit -> loadPendingOps() contains an {op:'update',entity:'timer'}
});
```

Fill these in against the file's existing harness (spy on `fetch` for the online case; `loadPendingOps()` for the offline case).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/useAppStore.test.ts -t 'timer'`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the helper near `mirrorTimerCreate`:

```ts
/** Mirror an edit to an already-synced timer: PATCH online, queue offline.
 *  Unsynced (serverId == null) timers need nothing here; their eventual create
 *  encodes the current fields. */
function mirrorTimerEdit(get: () => AppStore, timer: Timer): void {
  const s = get();
  const conn = s.connection;
  if (!conn || conn.mode !== 'server' || timer.serverId == null) return;
  if (s.offline) {
    void addPendingOp({ op: 'update', entity: 'timer', payload: timer });
  } else {
    void updateTimerOnServer(conn, timer).catch(() => {
      void addPendingOp({ op: 'update', entity: 'timer', payload: timer });
    });
  }
}
```

Wire it into each edit action, passing the UPDATED timer object (the one just written to state):

- In `saveTimerDetails`, after `set({ timers: ... })`, compute the updated timer and call it:
  ```ts
    const updated = get().timers.find((t) => t.id === timerId);
    if (updated) mirrorTimerEdit(get, updated);
  ```
- In `setTimerSaveAs`, `adjustTimerStart`, `setTimerStart`: after their `set(...)`, add:
  ```ts
    const updated = get().timers.find((t) => t.id === id);
    if (updated) mirrorTimerEdit(get, updated);
  ```
  (These currently use the `set((s) => ({...}))` form with no trailing statement. Convert each to a block body that sets, then reads back the updated timer and calls `mirrorTimerEdit`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/useAppStore.test.ts -t 'timer' && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(timers): mirror timer edits (name/start) online or via the offline op-log"
```

---

### Task 9: Store — mirror STOP / DISCARD (delete the server timer)

**Files:**
- Modify: `src/store/useAppStore.ts` (`stopTimer`, `discardTimer`, and the `save` "lasted X" stop path ~1741)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `deleteTimerFromServer` (Task 5); `addPendingOp`.
- Produces: module helper `mirrorTimerDelete(get, timer)` — if `timer.serverId != null`: online → DELETE; offline → enqueue `{ op:'delete', entity:'timer', serverId }`. If `serverId == null`: no-op.

- [ ] **Step 1: Write the failing test**

```ts
it('DELETEs the server timer when a synced timer is stopped online', async () => {
  // start+sync a timer (serverId 11), stopTimer(id), assert deleteTimer called for 11
});
it('queues a timer delete op when stopped offline', async () => {
  // offline: stopTimer(id) of a synced timer -> pendingOps has {op:'delete',entity:'timer',serverId:11}
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/useAppStore.test.ts -t 'server timer when a synced'`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the helper:

```ts
/** Mirror a stop/discard: delete the server timer (online) or queue the delete
 *  (offline). Unsynced timers (serverId == null) have no server record. */
function mirrorTimerDelete(get: () => AppStore, timer: Timer): void {
  const conn = get().connection;
  if (!conn || conn.mode !== 'server' || timer.serverId == null) return;
  if (get().offline) {
    void addPendingOp({ op: 'delete', entity: 'timer', serverId: timer.serverId });
  } else {
    void deleteTimerFromServer(conn, timer.serverId).catch(() => {
      void addPendingOp({ op: 'delete', entity: 'timer', serverId: timer.serverId as number });
    });
  }
}
```

In `stopTimer`, capture the timer before removal (it already has `tm`) and after `set({ timers: ..., entries: ... })` + `commitWrite`, add:

```ts
    mirrorTimerDelete(get, tm);
```

In `discardTimer`, change from the one-liner to look up the timer first:

```ts
  discardTimer: (id) => {
    const tm = get().timers.find((t) => t.id === id);
    set((s) => ({ timers: s.timers.filter((t) => t.id !== id) }));
    if (tm) mirrorTimerDelete(get, tm);
  },
```

In the `save` "lasted X" stop path (~1741, where `s.fromTimerId` drops the source timer), after the `set(patch)` add: look up the source timer from the pre-set snapshot `s.timers` and delete-mirror it:

```ts
    if (!existing && s.fromTimerId) {
      const src = s.timers.find((t) => t.id === s.fromTimerId);
      if (src) mirrorTimerDelete(get, src);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/useAppStore.test.ts -t timer && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(timers): mirror stop/discard by deleting the server timer (online or queued)"
```

---

### Task 10: Store — pull/reconcile, flush create, replay ops, server-switch reset

**Files:**
- Modify: `src/store/useAppStore.ts` (`refresh`, `hydrate`, `flushPendingOps`, `flushUnsynced`, adopt reset ~683)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `reconcileTimers` (Task 3); `pushTimerToServer`, `updateTimerOnServer`, `deleteTimerFromServer` (Task 5).
- Produces: refresh/hydrate reconcile `localTimers` with `data.timers`; reconnect flush pushes `serverId == null` timers; `flushPendingOps` replays timer ops; server-switch reset strips timer `serverId`s.

- [ ] **Step 1: Write the failing test**

```ts
it('reconciles server timers on refresh: adds new, drops locally-synced-but-gone', async () => {
  // local timers: [synced serverId 5, unsynced local]. Mock loadFromServer.timers -> [serverId 6 only].
  // After refresh: expect the unsynced local kept, serverId-5 dropped, serverId-6 added.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/useAppStore.test.ts -t 'reconciles server timers'`
Expected: FAIL (refresh overwrites timers with `localTimers` only).

- [ ] **Step 3: Implement**

In `refresh`, change `timers: localTimers,` (line ~606) to:

```ts
        timers: reconcileTimers(localTimers, data.timers),
```

In `hydrate` (server branch, line ~539), change `timers: savedTimers,` to:

```ts
        timers: reconcileTimers(savedTimers, data.timers),
```

Add a reconnect create-flush. In `flushUnsynced`, after the children/measurements block, push unsynced timers (their child must be synced). Insert before the closing of the try:

```ts
      // Timers created offline (serverId == null): POST each whose child is
      // synced, then stamp serverId. Mirrors the child/measurement flush above.
      const st2 = get();
      for (const timer of st2.timers) {
        if (timer.serverId != null) continue;
        const child = st2.children.find((c) => c.id === (timer.childId ?? st2.selectedChildId));
        if (!child || child.serverId == null) continue;
        const serverId = await pushTimerToServer(conn, timer, child.serverId).catch(() => undefined);
        if (serverId != null) {
          set((s3) => ({ timers: s3.timers.map((t) => (t.id === timer.id ? { ...t, serverId } : t)) }));
        }
      }
```

(Remove the early `return` at `if (!hasUnsynced) return;` so timers still flush when only timers are unsynced. Replace it with: compute `hasUnsynced` including timers, or drop the early-return and let the block run. Simplest: change the guard to also consider timers:
```ts
      const hasUnsyncedTimer = s.timers.some((t) => t.serverId == null);
      if (!hasUnsynced && !hasUnsyncedTimer) return;
```
and guard the `uploadUnsynced` call with `if (hasUnsynced) { ...existing children/measurements block... }`.)

In `flushPendingOps`, add two cases inside the `for (const op of ops)` try:

```ts
        else if (op.op === 'update' && op.entity === 'timer') await updateTimerOnServer(conn, op.payload);
        else if (op.op === 'delete' && op.entity === 'timer') await deleteTimerFromServer(conn, op.serverId);
```

In the adopt server-switch reset (~683-687), also strip timer serverIds:

```ts
      set((st) => ({
        children: st.children.map((c) => ({ ...c, serverId: undefined })),
        entries: st.entries.map((e) => ({ ...e, serverId: undefined })),
        measurements: st.measurements.map((m) => ({ ...m, serverId: undefined })),
        timers: st.timers.map((t) => ({ ...t, serverId: undefined })),
      }));
```

Add the `reconcileTimers` import: `import { reconcileTimers } from '@/data/serverTimers';`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/useAppStore.test.ts && npx tsc --noEmit`
Expected: PASS (full store suite)

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(timers): pull/reconcile on refresh, flush unsynced timers, replay timer ops, reset on server switch"
```

---

### Task 11: Pull-to-refresh on the timers page

**Files:**
- Modify: `src/app/(tabs)/timers.tsx`

**Interfaces:**
- Consumes: `refresh` store action; `useWebPullToRefresh(scrollRef, refresh)` returning `{ enabled, style, glyphStyle, refreshing }`.

- [ ] **Step 1: Add the refresh wiring (mirror `index.tsx`)**

At the top of `timers.tsx`, extend the react-native import to include `Platform`, `RefreshControl`, and add `useCallback, useRef` from react, `Animated` from `react-native-reanimated`, and the hook + Icon/theme pieces already imported. Then inside the component, after the existing store selectors:

```tsx
  const refresh = useAppStore((s) => s.refresh);
  const canPullToRefresh = Platform.OS !== 'web';
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [refresh]);
  const scrollRef = useRef<ScrollView | null>(null);
  const webPull = useWebPullToRefresh(scrollRef, refresh);
```

Add the imports:
```tsx
import { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useWebPullToRefresh } from '@/features/dashboard/useWebPullToRefresh';
```

- [ ] **Step 2: Wrap the mobile `ScrollView` (only the non-desktop return, ~342)**

Replace the mobile `return (<ScrollView ...>...)` with a version that adds the `ref`, `refreshControl`, and the web pull indicator (copy the indicator block + `RefreshControl` usage verbatim from `src/app/(tabs)/index.tsx:118-170`, adapting `insets`/`t`). Desktop branch (`DesktopPage`) is unchanged (matches `index.tsx`, whose desktop branch has no pull-to-refresh).

```tsx
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {webPull.enabled && (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: insets.top - 6, left: 0, right: 0, alignItems: 'center', zIndex: 25 }, webPull.style]}>
          {/* same 44x44 indicator circle as index.tsx, showing webPull.refreshing ? spinner : rotated glyph */}
        </Animated.View>
      )}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
        refreshControl={canPullToRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.textDim} /> : undefined}
      >
        <Txt weight={800} size={27} tracking={-0.6} style={{ paddingHorizontal: 2, paddingTop: 4, paddingBottom: 18 }}>
          Timers
        </Txt>
        {body}
      </ScrollView>
    </View>
  );
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint src/app/\(tabs\)/timers.tsx`
Expected: PASS

- [ ] **Step 4: Manual verify**

Run the app (web is quickest): `npm run web`. Start a timer on the Timers page. In a second browser/profile signed into the same Baby Buddy account (or after starting one in Baby Buddy's own UI), pull down on the Timers page and confirm the timer appears; stop it on one device and confirm it clears on the other after a pull.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(tabs\)/timers.tsx
git commit -m "feat(timers): pull-to-refresh on the Timers page"
```

---

## Self-Review

**Spec coverage:**
- Data model `serverId` → Task 1; `childId` addition (correctness enabler for the child-FK round-trip the spec requires) → Task 1.
- Encoding structural fields + amount in `name`, foreign-name tolerance, version marker → Task 2.
- Reconcile four cases + no-loop invariant → Task 3 (invariant holds: everything added/kept carries a serverId, and the reconnect flush in Task 10 only pushes serverId==null).
- Native `/api/timers/` CRUD → Task 4; repository wrappers + `loadFromServer` population → Task 5.
- Lifecycle: create → Task 7; edit → Task 8; stop/discard → Task 9 (entry commit stays on the existing local path, untouched).
- Offline op-log variants → Task 6; replay + create-flush → Task 10.
- Pull on refresh/hydrate/reconnect → Task 10; pull-to-refresh on the timers page → Task 11.
- Edge cases: start-then-immediately-stop orphan cleanup → Task 7; server-switch reset strips timer serverIds → Task 10; foreign timers → Task 2; unknown/unsynced child skipped → Task 5 (`loadFromServer`) and Task 7/10 (child-not-synced guards).

**Deviations from the spec, to confirm with the user:**
1. The spec listed the tummy `milestone` among carried fields, but it is freeform text, not an enum/flag. To keep the delimited `name` grammar robust it is treated like notes/tags (device-local, NOT carried). A cross-device stop of a tummy timer omits the milestone text; the stopping device can add it.
2. `Timer.childId` is added (not in the spec) because the local model was child-agnostic; required for a correct child-FK round-trip and offline-deferred create.
3. Timers are pulled for ALL of the user's children and shown together (no per-child filter), matching the current "show all running timers" behavior. With two children their timers intermix without a child label; a label/filter is a possible follow-up.

**Risks to verify during implementation:**
- Baby Buddy must accept a client-provided `start` on timer create/PATCH (some versions may force start=now). If it ignores `start`, cross-device elapsed time is anchored to the server's create time. Verify against the target instance; if unsupported, note it as a known caveat.
- `PATCH`/`DELETE` on `/api/timers/{id}/` are assumed available (standard DRF). Verify; fallback for PATCH is DELETE + re-POST.
