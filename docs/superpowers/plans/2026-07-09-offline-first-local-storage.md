# Offline-First Local Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app fully usable with no Baby Buddy server (durable on-device storage), let users later "adopt" a fresh server by pushing all local data up one-way, and make offline child/measurement writes durable for connected users.

**Architecture:** Replace the ephemeral `demo` connection flag with a persistent `local`/`server` mode. Persist children/entries/measurements to AsyncStorage (the existing `queue.ts`/`timers.ts` pattern) via a Zustand `subscribe`. Give `Child` a `serverId` and keep the local `id` as the permanent primary key so foreign refs never rewrite; a single `uploadUnsynced()` primitive maps local→server ids only at upload time, used by both reconnect-flush and the adopt flow.

**Tech Stack:** Expo SDK 56, React Native 0.85, Zustand 5, `@react-native-async-storage/async-storage`, `expo-secure-store`, vitest 3. No new dependencies.

## Global Constraints

- **Expo SDK 56** — consult https://docs.expo.dev/versions/v56.0.0/ before any Expo API use. (This feature touches almost no Expo API; it's store + AsyncStorage + RN UI.)
- **No new dependency.** Persistence is AsyncStorage JSON only (no SQLite/MMKV/Realm).
- **Path alias** `@/` → `src/`.
- **Tests: vitest** (`npm test` → `vitest run`). Follow existing data-layer test style (`src/data/*.test.ts`, `src/store/useAppStore.test.ts`). Persistence-module tests mirror `src/data/timers` / `prefs` AsyncStorage tests.
- **Storage keys are versioned**: `babybuddy.<name>.v1`.
- **Copy/naming**: "Baby Buddy" (two words) in user-facing copy, matching existing screens.
- **Commit trailers** on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017KkNe3Ee5GNX72Dr1iZcfi
  ```
- **Never push / open PRs** without explicit user go-ahead.
- Spec: `docs/superpowers/specs/2026-07-09-offline-first-local-storage-sync-design.md` (read it — every task's requirements derive from it).

---

## File Structure

**New files:**
- `src/data/entityStore.ts` — durable AsyncStorage persistence for `children`/`entries`/`measurements`/`selectedChildId`/`lastFeed`. Guarded `load*`/`save*`/`clear*`, mirroring `timers.ts`.
- `src/data/entityStore.test.ts` — round-trip + corrupt-JSON fallback tests.
- `src/data/pendingOps.ts` — the update/delete op-log (`babybuddy.pendingOps.v1`).
- `src/data/pendingOps.test.ts`.
- `src/data/sync.ts` — `uploadUnsynced()` (the adopt/flush uploader), `mergeUnsynced()`, emptiness check, child-dedup. Pure logic given injected repository fns.
- `src/data/sync.test.ts`.
- `src/features/connect/AdoptSheet.tsx` — the adopt flow UI (Phase 3).

**Modified files:**
- `src/types/models.ts` — add `Child.serverId`.
- `src/data/repository.ts` — `Connection` becomes `{mode:'local'} | {mode:'server';serverUrl;token}`; add `serverHasData()`; branch functions on `mode`.
- `src/data/storage.ts` — connection migration (`demo`→`mode`).
- `src/api/client.ts` — `listChildren` sets `serverId`; `updateChild`/`createChild` key off `serverId`; add a `hasAnyChildren`/count probe if needed.
- `src/store/useAppStore.ts` — mode-aware `hydrate`/`refresh`/`connect`; `enterLocal` (replaces `enterDemo`); `saveChild`/`saveMeasurement`/`commitWrite`/`deleteEntry`/`deleteMeasurement` local + offline branches; entity-store `subscribe`; generalized flush = `uploadUnsynced`; `mergeUnsynced`.
- `src/app/onboarding.tsx` — "Try the demo" → "Start now — connect Baby Buddy later".
- `src/app/settings.tsx` — local-mode "Connect Baby Buddy" entry + data summary.
- `src/widgets/napToggle.ts` / `src/widgets/snapshot.ts` — mode-aware headless persistence (Phase 2).
- `src/data/seed.ts` — retained only if a dev "load sample data" affordance is kept; otherwise unreferenced after `enterDemo` removal (leave the file, drop the import).

---

# Phase 1 — Foundation

Durable local store, `Child.serverId`, connection `mode` + migration, `enterLocal`, local-mode hydrate. Delivers: a fully usable no-server local mode whose data survives restart; fixes the child/measurement "vanish" bug for local mode. Each task ends green (`npm test`) and typechecks (`npx tsc --noEmit`).

### Task 1.1: Add `serverId` to `Child`; populate it on server load

**Files:**
- Modify: `src/types/models.ts` (the `Child` interface, ~line 15)
- Modify: `src/api/client.ts` (`listChildren` ~line 292; `updateChild` ~line 317)
- Test: `src/api/client.test.ts`

**Interfaces:**
- Produces: `Child.serverId?: number`. `client.updateChild` now requires `child.serverId` (not `Number(child.id)`).

- [ ] **Step 1: Write failing test** in `src/api/client.test.ts` — assert `listChildren` maps a server child `{id: 7, …}` to `{ id: '7', serverId: 7 }`. (Mirror the existing `request`-mocking style already in that file; if `listChildren` isn't yet covered, mock `request` to return `{ results: [{ id: 7, first_name: 'A', birth_date: '2024-01-01' }] }`.)

- [ ] **Step 2: Run** `npx vitest run src/api/client.test.ts` → FAIL (`serverId` undefined).

- [ ] **Step 3: Implement.** In `models.ts` add to `Child`:
```ts
  /** server numeric id; present once created on / loaded from a server */
  serverId?: number;
```
In `client.ts` `listChildren` map add `serverId: c.id,` alongside `id: String(c.id)`. In `updateChild`, replace `const id = Number(child.id); if (!Number.isFinite(id)) return undefined;` with:
```ts
    const id = child.serverId;
    if (id == null) return undefined;
```
(URL stays `/children/${id}/`.)

- [ ] **Step 4: Run** `npx vitest run src/api/client.test.ts` → PASS. Then `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit** `feat(model): add Child.serverId; key server child ops off it`.

### Task 1.2: Connection `mode` model + migration

**Files:**
- Modify: `src/data/repository.ts` (`Connection`, line 21)
- Modify: `src/data/storage.ts` (`loadConnection`)
- Test: `src/data/storage.test.ts` (create if absent, mirror `prefs.test`/`servers.test` AsyncStorage/secureKv mocking)

**Interfaces:**
- Produces:
```ts
export type Connection =
  | { mode: 'local' }
  | { mode: 'server'; serverUrl: string; token: string };
```
- `loadConnection(): Promise<Connection | null>` migrates legacy `{demo,serverUrl,token}`.

- [ ] **Step 1: Write failing tests** in `storage.test.ts`: (a) a stored legacy `{"demo":true,"serverUrl":"","token":""}` loads as `{mode:'local'}`; (b) legacy `{"demo":false,"serverUrl":"https://x","token":"t"}` loads as `{mode:'server',serverUrl:'https://x',token:'t'}`; (c) a already-new `{"mode":"local"}` loads unchanged.

- [ ] **Step 2: Run** `npx vitest run src/data/storage.test.ts` → FAIL.

- [ ] **Step 3: Implement.** Change `Connection` in `repository.ts` to the union above. In `storage.ts` `loadConnection`, after `JSON.parse`, migrate:
```ts
    const raw = JSON.parse(s) as any;
    if (raw && typeof raw === 'object' && 'demo' in raw) {
      return raw.demo
        ? { mode: 'local' }
        : { mode: 'server', serverUrl: raw.serverUrl, token: raw.token };
    }
    return raw as Connection;
```

- [ ] **Step 4:** `npx vitest run src/data/storage.test.ts` → PASS. `npx tsc --noEmit` will now FAIL across the store/repository (every `conn.demo`) — that's expected and fixed in 1.3–1.4. Do not "fix" by reverting.

- [ ] **Step 5: Commit** `feat(data): Connection local/server mode + legacy demo migration`.

### Task 1.3: Repository — branch on `mode`

**Files:**
- Modify: `src/data/repository.ts` (all functions; the `conn.demo` guards)
- Test: `src/data/repository.test.ts` (extend existing)

**Interfaces:**
- Consumes: `Connection` union (1.2).
- Produces: repository fns gate on `conn.mode === 'local'` (was `conn.demo`) for the "no server" short-circuit; server fns require `conn.mode === 'server'` to read `serverUrl`/`token`.

- [ ] **Step 1: Write failing test** — `loadFromServer` / `pushEntryToServer` etc. still short-circuit (return `[]`/`undefined`) when `conn = {mode:'local'}`.

- [ ] **Step 2: Run** relevant test → FAIL (type error / wrong behavior).

- [ ] **Step 3: Implement.** In every repository fn, replace `if (conn.demo) return …` with `if (conn.mode === 'local') return …`, and inside the server path narrow with the `mode` discriminant so `conn.serverUrl`/`conn.token` typecheck (they exist only on the `server` variant). E.g.:
```ts
export async function pushEntryToServer(conn: Connection, entry: Entry) {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createEntry(entry);
}
```

- [ ] **Step 4:** `npx vitest run src/data/repository.test.ts` → PASS.

- [ ] **Step 5: Commit** `refactor(repository): branch on connection mode`.

### Task 1.4: `entityStore.ts` — durable persistence module

**Files:**
- Create: `src/data/entityStore.ts`
- Test: `src/data/entityStore.test.ts`

**Interfaces:**
- Produces:
```ts
export async function loadEntities(): Promise<{
  children: Child[]; entries: Entry[]; measurements: Measurement[];
  selectedChildId: string; lastFeed: { feedType: FeedType; method: FeedMethod };
} | null>;
export async function saveChildren(v: Child[]): Promise<void>;
export async function saveEntries(v: Entry[]): Promise<void>;
export async function saveMeasurements(v: Measurement[]): Promise<void>;
export async function saveSelectedChildId(v: string): Promise<void>;
export async function saveLastFeed(v: { feedType: FeedType; method: FeedMethod }): Promise<void>;
export async function clearEntities(): Promise<void>;
```
Keys: `babybuddy.children.v1`, `.entries.v1`, `.measurements.v1`, `.selectedChild.v1`, `.lastFeed.v1`. `loadEntities` returns `null` only when *nothing* has ever been written (all keys absent); otherwise fills missing collections with `[]`/defaults. All reads guarded (corrupt JSON → default), matching `timers.ts`.

- [ ] **Step 1: Write failing tests** (mirror `timers.test`): round-trip children/entries/measurements; corrupt JSON → `[]`; all-absent → `null`.

- [ ] **Step 2: Run** `npx vitest run src/data/entityStore.test.ts` → FAIL.

- [ ] **Step 3: Implement** following `timers.ts` exactly (per-key `getItem`/`setItem`, `try/catch` returning defaults). Complete code — one guarded getter/setter per key; `loadEntities` reads all keys in parallel with `Promise.all`, returns `null` if every key is absent.

- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit** `feat(data): durable entityStore (children/entries/measurements)`.

### Task 1.5: Persist entities via store `subscribe`

**Files:**
- Modify: `src/store/useAppStore.ts` (import entityStore; add subscribe near the timers subscribe ~line 1278)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `entityStore` savers (1.4).

- [ ] **Step 1: Write failing test** — after a `saveChild` (or direct `set`), the entityStore saver is called with the new list. (Mock entityStore in the store test, like repository is mocked.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Add subscriptions mirroring the timers one:
```ts
useAppStore.subscribe((s, p) => {
  if (s.children !== p.children) void saveChildren(s.children);
  if (s.entries !== p.entries) void saveEntries(s.entries);
  if (s.measurements !== p.measurements) void saveMeasurements(s.measurements);
  if (s.selectedChildId !== p.selectedChildId) void saveSelectedChildId(s.selectedChildId);
  if (s.lastFeed !== p.lastFeed) void saveLastFeed(s.lastFeed);
});
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat(store): persist entities to entityStore on change`.

### Task 1.6: `enterLocal` + local-mode hydrate; retire `enterDemo` seeding

**Files:**
- Modify: `src/store/useAppStore.ts` (`enterDemo`→`enterLocal` ~line 470; `hydrate` demo branch ~line 330; `refresh` guard ~line 389; `disconnect` ~line 493 to `clearEntities`)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Produces: `enterLocal(): void` (was `enterDemo`). `hydrate` reads `entityStore` when `mode==='local'`.

- [ ] **Step 1: Write failing tests:** (a) `enterLocal` sets `connection={mode:'local'}`, `connected:true`, persists, and does **not** seed fake children; (b) `hydrate` with a persisted `{mode:'local'}` + a saved child loads that child (not the seed); (c) `refresh` is a no-op in local mode.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Rename `enterDemo`→`enterLocal`: build `conn={mode:'local'}`, set connected, load persisted entities (or empty), no `makeSeed`. In `hydrate`, replace the `conn.demo` branch with a `conn.mode==='local'` branch that does `const e = await loadEntities()` and sets `children/entries/measurements/selectedChildId/lastFeed` from it (empty defaults when `null`), plus `timers: savedTimers`. In `refresh`, change the guard `conn.demo` → `conn.mode !== 'server'`. In `disconnect`, add `void clearEntities()`. Update the `AppActions` type: `enterDemo`→`enterLocal`.

- [ ] **Step 4: Run** `npm test` → PASS; `npx tsc --noEmit` → PASS (onboarding still references `enterDemo` — fix in 1.7, or update the type and onboarding together here; if split, expect a transient onboarding type error).

- [ ] **Step 5: Commit** `feat(store): persistent local mode (enterLocal + local hydrate)`.

### Task 1.7: Onboarding — "Start now, connect later"

**Files:**
- Modify: `src/app/onboarding.tsx` (the `enterDemo` usage line 27 + button lines 250–258)
- Test: none (thin presentational; covered by the store test for `enterLocal`)

- [ ] **Step 1:** Replace `const enterDemo = useAppStore((s) => s.enterDemo);` with `const enterLocal = useAppStore((s) => s.enterLocal);`. Change the bottom `Pressable`'s `onPress={enterDemo}` → `onPress={enterLocal}` and its copy to:
```tsx
  <Txt unselectable weight={600} size={13.5} color={t.dim}>
    No server?{' '}
    <Txt unselectable weight={700} size={13.5} color={t.primary}>Start now — connect later →</Txt>
  </Txt>
```

- [ ] **Step 2: Run** `npx tsc --noEmit` → PASS; `npm test` → PASS.

- [ ] **Step 3: Verify** the onboarding flow (see Phase 1 verification below).

- [ ] **Step 4: Commit** `feat(onboarding): promote demo to persistent local mode`.

### Phase 1 verification (before moving on)

- `npm test` and `npx tsc --noEmit` green.
- **Drive it** (per the `verify` skill / `run` skill): launch the app (`npm run web` is fastest), on onboarding tap "Start now", add a child, log a feed + a measurement, fully reload the page/app, and confirm the child, feed, and measurement are **still there**. This is the core promise of Phase 1.

---

# Phase 2 — Offline durability for connected users

Unified pending model, offline child/measurement, `mergeUnsynced`, `queue.ts` absorption, widget path. Delivers: connected users can add children/measurements/entries offline without losing them; they flush on reconnect.

### Task 2.1: `mergeUnsynced` (generalize `mergeQueuedEntries`)

**Files:** Modify `src/store/useAppStore.ts` (replace `mergeQueuedEntries` ~line 219 usage); Test `src/store/useAppStore.test.ts`.

**Interfaces:**
```ts
export function mergeUnsynced<T extends { id: string; serverId?: number }>(
  serverList: T[], localList: T[],
): T[]; // prepend localList items whose serverId == null and whose id isn't already in serverList
```

- [ ] Write failing test: a local child with `serverId==null` survives a merge with server children; a local record that now has a matching `serverId` is not duplicated. Implement the generic. Apply it to children/entries/measurements in `hydrate` **and** `refresh` (fixing the refresh asymmetry). Run → PASS. Commit `feat(store): mergeUnsynced across children/entries/measurements`.

### Task 2.2: `pendingOps.ts` op-log

**Files:** Create `src/data/pendingOps.ts` + test.

**Interfaces:**
```ts
type PendingOp =
  | { op: 'update'; entity: 'child'|'entry'|'measurement'; payload: Child|Entry|Measurement }
  | { op: 'delete'; entity: 'entry'|'measurement'; type: ActivityType|MeasurementKind; serverId: number };
export async function loadPendingOps(): Promise<PendingOp[]>;
export async function addPendingOp(o: PendingOp): Promise<PendingOp[]>;
export async function savePendingOps(o: PendingOp[]): Promise<void>;
export async function clearPendingOps(): Promise<void>;
```
Key `babybuddy.pendingOps.v1`, guarded, mirrors `queue.ts`.

- [ ] TDD round-trip + append + corrupt-fallback. Commit `feat(data): pendingOps op-log`.

### Task 2.3: Offline branches in `saveChild` / `saveMeasurement`

**Files:** Modify `src/store/useAppStore.ts` (`saveChild` ~572, `saveMeasurement` ~866); Test store test.

**Interfaces:** Consumes `Child.serverId` (1.1), `pendingOps` (2.2).

- [ ] Write failing tests: (a) `saveChild` create while `mode==='server'` + `offline` leaves the child in the store with `serverId==null` and does **not** call `pushChildToServer` (today it silently skips — new behavior: it's retained + pending); (b) editing a synced child offline appends an `update` pending op; (c) same for measurements. Implement: replace the `conn && !conn.demo && !s.offline` gate with a three-way branch — `mode==='local'` (store only), `server`+online (push, stamp serverId **not** overwrite id — remove the line-640 in-place swap: `set serverId` instead), `server`+offline (retain + pending). Run → PASS; `tsc` → PASS. Commit `feat(store): offline-durable child & measurement writes`.

### Task 2.4: `commitWrite` local + the delete paths

**Files:** Modify `src/store/useAppStore.ts` (`commitWrite` ~538; `deleteEntry` ~825; `deleteMeasurement` ~907).

- [ ] Write failing tests: `commitWrite` in `mode==='local'` keeps the entry locally (no server, no error); offline delete of a `serverId`'d entry records a `delete` pending op; offline delete of a `serverId==null` entry just drops it. Implement the branches. Run → PASS. Commit `feat(store): local-mode entries + offline delete tombstones`.

### Task 2.5: Absorb `queue.ts` into the unified flush

**Files:** Modify `src/store/useAppStore.ts` (`flushQueue` ~518 → delegate to `sync.uploadUnsynced` in Phase 3; interim: also replay `pendingOps`); add legacy-drain in `hydrate`.

- [ ] Write failing test: on `hydrate`, entries present in legacy `babybuddy.queue.v1` are merged into the durable store as `serverId==null` creates, and the legacy key is cleared. Implement the drain (read `loadQueue()`, merge into entities, `clearQueue()`). Keep `flushQueue` pushing entries for now; full unification lands with `uploadUnsynced` (3.1). Run → PASS. Commit `feat(store): drain legacy entry queue into durable store`.

### Task 2.6: Widget headless path → mode-aware

**Files:** Modify `src/widgets/napToggle.ts`, `src/widgets/snapshot.ts`; Test `src/widgets/*.test`.

- [ ] Update `snapshot.ts` `canQueueNap` from `!!connection && !connection.demo` to reflect the new model (queue in `server` mode; in `local` mode write the nap to the durable entities via a headless-safe path). Update `napToggle.ts` accordingly. TDD against the existing widget sync tests. Commit `feat(widget): mode-aware headless nap persistence`.

### Phase 2 verification

- `npm test` / `tsc` green.
- Drive: connect a (test) server, toggle Settings "simulate offline", add a child + a measurement + a feed, kill & relaunch, confirm they persist and show a pending count; turn offline off, confirm they flush (server receives them) and the pending count clears.

---

# Phase 3 — Adopt (local → fresh server)

`uploadUnsynced` + emptiness guard + child-dedup + adopt UX.

### Task 3.1: `sync.ts` — `uploadUnsynced()` core

**Files:** Create `src/data/sync.ts` + `src/data/sync.test.ts`.

**Interfaces:**
```ts
export interface UploadDeps {
  pushChild: (c: Child) => Promise<number | undefined>;   // returns serverId
  pushEntry: (e: Entry) => Promise<number | undefined>;
  pushMeasurement: (m: Measurement) => Promise<number | undefined>;
}
export interface UploadState { children: Child[]; entries: Entry[]; measurements: Measurement[]; }
export async function uploadUnsynced(
  state: UploadState, deps: UploadDeps,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadState>; // returns state with serverId stamped; childId remapped to server ids on entries/measurements
```

- [ ] Write failing tests (pure — inject fake `deps`): children upload before their entries/measurements; entries/measurements are pushed with `childId` = the child's new `serverId`; a record already carrying `serverId` is skipped (idempotent); if `pushEntry` throws, that record keeps `serverId==null` and the returned state is still valid (resumable). Implement the ordered walk. Run → PASS. Commit `feat(sync): uploadUnsynced (ordered, idempotent, ref-remapping)`.

### Task 3.2: emptiness probe + child-dedup

**Files:** Modify `src/api/client.ts` (add `countChildren()` or reuse `listChildren`), `src/data/repository.ts` (`serverHasData(conn)`), `src/data/sync.ts` (dedup helper); tests.

**Interfaces:**
```ts
export async function serverHasData(conn: Connection): Promise<boolean>;
// dedup: given server children + a local child, return the matching serverId by first+birth, or null
export function matchServerChild(local: Child, server: Child[]): number | null;
```

- [ ] TDD: `serverHasData` true when `listChildren` non-empty; `matchServerChild` matches on `first` (case-insensitive trim) + `birth` (same calendar day). Wire an `attachTo?: number` path into `uploadUnsynced` so an override run attaches a matched local child's entries to the existing `serverId` instead of creating it. Commit `feat(sync): server emptiness probe + child-level dedup`.

### Task 3.3: adopt orchestration in the store

**Files:** Modify `src/store/useAppStore.ts` — add `adopt(serverUrl, token, opts?: { uploadAnyway?: boolean })`; make `flushQueue` delegate to `uploadUnsynced` (unifies Phase 2's TODO); server-switch `serverId` reset.

**Interfaces:** `adopt(...)` returns a result the UI drives (`{ status: 'empty'|'guard'|'uploading'|'done'|'error', … }`), only flipping `connection` to `{mode:'server',…}` on full success; persists `pendingAdoptionTarget`; clears stale `serverId`s when the target server differs.

- [ ] TDD the orchestration against mocked repository/sync: empty → uploads → switches mode → `loadFromServer`; non-empty + no override → stays local, returns guard; non-empty + override → uploads with dedup; interrupted upload leaves `mode:'local'` + stamped serverIds; different-target clears prior serverIds. Commit `feat(store): adopt orchestration with guard, resumability, server-switch reset`.

### Task 3.4: Adopt UI

**Files:** Create `src/features/connect/AdoptSheet.tsx`; modify `src/app/settings.tsx` (local-mode "Connect Baby Buddy" entry + data summary) and `src/app/onboarding.tsx` (route the connect form through `adopt` when local data exists).

- [ ] Build the state-machine UI (form → checking → confirm/guard → uploading w/ progress → done; "Retry sync" on partial failure). Add the Settings entry + "N children, M entries on this device" summary. Manual verify (no unit test for the presentational sheet). Commit `feat(connect): adopt flow UI (onboarding + settings)`.

### Phase 3 verification

- `npm test` / `tsc` green.
- Drive end-to-end: from local mode with data, connect a **fresh** test server → confirm children→entries→measurements appear on the server, app switches to server mode, counts match. Then repeat against a **non-empty** server → confirm the guard, and that "Upload anyway" reuses the matching child.

---

## Self-Review (spec coverage)

- Local mode (no server) → 1.6/1.7. Durable store → 1.4/1.5. `Child.serverId`/stable id → 1.1 + 2.3 (drop in-place swap). Connection mode + migration → 1.2/1.3. Offline child/measurement → 2.3/2.4. `mergeUnsynced` (both hydrate+refresh) → 2.1. Pending ops → 2.2. Legacy queue absorption → 2.5. Widget → 2.6. Uploader/resumable/idempotent → 3.1/3.3. Emptiness guard + child-dedup → 3.2/3.3. Adopt UX → 3.4. Server-switch serverId reset → 3.3. Photos-in-local upload on adopt → covered by 3.1 (pushChild carries the child; picture handled by existing `pushChildToServer` PhotoChange path).
- Out-of-scope items (continuous sync, entry-level merge, offline read-cache, server→local) have no tasks — correct.
