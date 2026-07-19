# Stable Child Ids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a child's `id` changing when it is pushed to Baby Buddy, so the entries and measurements referencing it can never be orphaned.

**Architecture:** A child's `id` is assigned once and never changes. `serverId` becomes the only field stamped onto it and the only thing sent to the server. Server data is reconciled onto local records by matching `serverId` rather than replacing the list wholesale, which is what forced the re-key to exist. Every push path takes an explicit `childServerId` parameter so TypeScript makes it impossible to send a local id to the server.

**Tech Stack:** Expo SDK 56, React Native 0.85, React 19, zustand v5 store (`src/store/useAppStore.ts`), vitest.

## Global Constraints

- **Expo version:** SDK 56. Read the versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any Expo API code (per `AGENTS.md`).
- **No em-dashes** in any prose, comment, or UI copy. Use commas, colons, or separate sentences.
- **THE INVARIANT, which every task serves:** a child's `id` is assigned once at creation and never changes. `serverId` is the only field ever stamped onto it, and `serverId` is the only thing ever sent to the server.
- **Never rewrite stored ids for a push.** Remap into the payload copy only, the way `uploadUnsynced` already does (`src/data/sync.ts`, around line 89: it pushes `{ ...entry, childId: String(serverChildId) }` and stamps only `serverId` onto the stored record).
- **zustand v5 selectors:** never return a fresh reference from a `useAppStore` selector.
- **Tests:** `npx vitest run`. Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`.
- **Known pre-existing lint problems**, in files this work does not touch: `src/lib/photo.ts` (unresolved `expo-image-picker`) and `src/data/sync.test.ts` (array-type warning). Neither is yours.
- **Path alias:** `@/` maps to `src/`.
- **Branch:** `stable-child-ids`, off `main`, which already holds the spec commit.
- **Do NOT start the Expo dev server or run Playwright.** Task 7 is a controller-run pass.
- **This branch is NOT based on `expecting-child-state`.** That branch is paused. Do not import anything from it, and do not expect `pushAndRekeyChild` or `mergeHeldBackEntries` to exist here; they do not.

---

### Task 1: `reconcileChildren`

The helper that replaces wholesale replacement with identity-preserving reconciliation. Pure, so it carries real tests, and everything later depends on it.

**Files:**
- Modify: `src/store/useAppStore.ts` (add beside the existing `mergeUnsynced` at ~line 359)
- Modify: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `reconcileChildren(serverChildren: Child[], localChildren: Child[]): Child[]`, exported from `@/store/useAppStore` the same way `mergeUnsynced` and `mergeQueuedEntries` are. Task 5 uses it.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/useAppStore.test.ts`. Merge `reconcileChildren` into the existing import from `@/store/useAppStore`.

```ts
describe('reconcileChildren', () => {
  const kid = (over: Partial<Child> = {}): Child => ({
    id: 'x',
    first: 'Ada',
    last: '',
    birth: Date.parse('2026-01-01'),
    color: '#E8A87C',
    ...over,
  });

  it('keeps the LOCAL id when a server child matches by serverId', () => {
    const server = [kid({ id: '501', serverId: 501, first: 'Ada' })];
    const local = [kid({ id: 'child1752', serverId: 501, first: 'Ada' })];
    const out = reconcileChildren(server, local);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('child1752');
    expect(out[0].serverId).toBe(501);
  });

  it('takes the server copy of every other field on a match', () => {
    const server = [kid({ id: '501', serverId: 501, first: 'Adaline', picture: 'https://s/a.jpg' })];
    const local = [kid({ id: 'child1752', serverId: 501, first: 'Ada', picture: 'file:///tmp/a.jpg' })];
    const out = reconcileChildren(server, local);
    expect(out[0].first).toBe('Adaline');
    expect(out[0].picture).toBe('https://s/a.jpg');
  });

  it('adds a server child the app has never seen, keeping its server-derived id', () => {
    const out = reconcileChildren([kid({ id: '502', serverId: 502 })], []);
    expect(out.map((c) => c.id)).toEqual(['502']);
  });

  it('keeps a local child that has never been pushed', () => {
    const local = [kid({ id: 'child999' })]; // no serverId
    const out = reconcileChildren([kid({ id: '501', serverId: 501 })], local);
    expect(out.map((c) => c.id)).toEqual(['child999', '501']);
  });

  it('never duplicates a child that is both local-with-serverId and on the server', () => {
    const server = [kid({ id: '501', serverId: 501 })];
    const local = [kid({ id: 'child1752', serverId: 501 })];
    expect(reconcileChildren(server, local)).toHaveLength(1);
  });

  it('prepends local-only children and preserves the server order', () => {
    const server = [kid({ id: '501', serverId: 501 }), kid({ id: '502', serverId: 502 })];
    const local = [kid({ id: 'localA' }), kid({ id: 'localB' })];
    expect(reconcileChildren(server, local).map((c) => c.id)).toEqual(['localA', 'localB', '501', '502']);
  });

  it('drops a local child whose serverId is no longer on the server', () => {
    // Deleted from Baby Buddy elsewhere. The server is authoritative for
    // children it knows about, which is today's behaviour and must not change.
    const out = reconcileChildren([], [kid({ id: 'child1752', serverId: 501 })]);
    expect(out).toEqual([]);
  });

  it('returns an empty list when both sides are empty', () => {
    expect(reconcileChildren([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/store/useAppStore.test.ts -t reconcileChildren`
Expected: FAIL, `reconcileChildren` is not exported.

- [ ] **Step 3: Implement it**

Add to `src/store/useAppStore.ts`, directly below `mergeUnsynced`:

```ts
/** Reconcile a server child list onto the local one WITHOUT changing any local
 *  `id`. A child that exists on both sides is matched by `serverId` and the
 *  server's field values win, but the local `id` is preserved, because entries
 *  and measurements reference it and rewriting it would orphan them. That
 *  orphaning is the bug this whole design exists to prevent.
 *
 *  Local children with no `serverId` were never pushed (an offline creation, or
 *  a child deliberately held back) and are kept, prepended, which is where
 *  `mergeUnsynced` put them. Server children the app has not seen are added
 *  with their server-derived id: they never had a local phase, so that id is
 *  already stable. A local child whose `serverId` is absent from the server list
 *  was deleted server-side and is dropped, matching today's behaviour. */
export function reconcileChildren(serverChildren: Child[], localChildren: Child[]): Child[] {
  const localByServerId = new Map<number, Child>();
  for (const c of localChildren) {
    if (c.serverId != null) localByServerId.set(c.serverId, c);
  }
  const reconciled = serverChildren.map((sc) => {
    const local = sc.serverId != null ? localByServerId.get(sc.serverId) : undefined;
    return local ? { ...sc, id: local.id } : sc;
  });
  const neverPushed = localChildren.filter((c) => c.serverId == null);
  return [...neverPushed, ...reconciled];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/store/useAppStore.test.ts -t reconcileChildren`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass. Nothing calls the new function yet, so nothing else changes.

- [ ] **Step 6: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(ids): reconcileChildren, matching by serverId without re-keying"
```

---

### Task 2: Thread `childServerId` through the API client

The client currently sends `child: entry.childId`, which only works because ids were being rewritten. Make the server id an explicit parameter so no caller can pass a local id by accident.

**Files:**
- Modify: `src/api/client.ts` (the three note-body helpers, `buildBody`, `createEntry`, `updateEntry`, the measurement body, `createMeasurement`, `updateMeasurement`)

**Interfaces:**
- Consumes: nothing.
- Produces, all with `childServerId: number` added as a required trailing parameter:
  - `bathToNoteBody(entry, childServerId)`, `noteToNoteBody(entry, childServerId)`, `milestoneToNoteBody(entry, childServerId)`
  - `BabybuddyClient.createEntry(entry, childServerId)`, `.updateEntry(entry, childServerId)`
  - `BabybuddyClient.createMeasurement(m, childServerId)`, `.updateMeasurement(m, childServerId)`

  Task 3 calls these.

- [ ] **Step 1: Add the parameter to the three note-body helpers**

Each currently sends `child: entry.childId`. Add a required `childServerId: number` parameter and send that instead. For example `bathToNoteBody` becomes:

```ts
export function bathToNoteBody(entry: BathEntry, childServerId: number): Record<string, unknown> {
  const userTags = entry.tags.filter((t) => !BATH_STRUCTURAL_TAGS.includes(t) && !isStructuralMilestoneTag(t));
  return {
    child: childServerId,
    time: toISO(entry.time),
    note: `Bath, ${entry.wash} wash`,
    tags: ['bath', entry.wash, ...userTags],
  };
}
```

Note the `note` string: the original contains an em-dash (`Bath — ${entry.wash} wash`), which this project forbids. Since you are editing the line anyway, replace it with a comma as shown. Do the same for any other em-dash in a body you touch.

Apply the identical parameter change to `noteToNoteBody` and `milestoneToNoteBody`, replacing their `child: entry.childId` with `child: childServerId` and leaving everything else alone.

- [ ] **Step 2: Add the parameter to `buildBody` and the entry methods**

`buildBody` is the private dispatcher that builds a body per entry type. Give it a required `childServerId: number` parameter, pass that through to each of the three note-body helpers, and replace every other `child: entry.childId` inside it with `child: childServerId`.

Then update the two public methods:

```ts
  async createEntry(entry: Entry, childServerId: number): Promise<number | undefined> {
    const res = await this.request<{ id?: number }>(`/${ENDPOINT[entry.type]}/`, {
      method: 'POST',
      body: JSON.stringify(this.buildBody(entry, childServerId)),
    });
    return res?.id;
  }

  /** Update an existing entry on the server (requires entry.serverId). */
  async updateEntry(entry: Entry, childServerId: number): Promise<void> {
    if (entry.serverId == null) return;
    await this.request(`/${ENDPOINT[entry.type]}/${entry.serverId}/`, {
      method: 'PATCH',
      body: JSON.stringify(this.buildBody(entry, childServerId)),
    });
  }
```

- [ ] **Step 3: Do the same for measurements**

The measurement body currently reads `{ child: m.childId, date: ..., [MEAS_FIELD[m.kind]]: m.value, notes: ... }` (around line 686). Give whatever function builds it a required `childServerId: number` and send `child: childServerId`. Then add the same parameter to `createMeasurement` and `updateMeasurement` and pass it through.

- [ ] **Step 4: Find every remaining local-id send**

Run: `grep -n "child: entry.childId\|child: m.childId" src/api/client.ts`
Expected: NO output. If any line remains, it is a path that would send a local id to the server; fix it the same way.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

Expected: **errors, and that is correct at this point.** Every call site in `src/data/repository.ts` now fails to compile because it is missing the new argument. That is the parameter doing its job. Do NOT fix those call sites here and do NOT add a default value to make the errors go away; Task 3 owns them. Confirm in your report that EVERY error is a missing-argument error at a `createEntry`/`updateEntry`/`createMeasurement`/`updateMeasurement`/`*ToNoteBody` call, and that there are no errors of any other kind.

- [ ] **Step 6: Commit**

```bash
git add src/api/client.ts
git commit -m "feat(ids): send an explicit childServerId, never a local id"
```

Note: the tree does not typecheck at this commit. That is intentional and is resolved by Task 3. Do not try to make it green here.

---

### Task 3: Thread `childServerId` through the repository layer

**Files:**
- Modify: `src/data/repository.ts` (`pushEntryToServer` ~line 227, `pushMeasurementToServer` ~line 170, and the update functions for both)
- Modify: `src/api/client.test.ts` (12 direct calls to the Task 2 client methods)
- Modify: `scripts/itest.ts` (7 direct calls; a manual integration script run against a real server)

**Interfaces:**
- Consumes: the Task 2 client methods.
- Produces, following the shape `pushTimerToServer` already has (`repository.ts:256-259`):
  - `pushEntryToServer(conn, entry, childServerId: number)`
  - `pushMeasurementToServer(conn, m, childServerId: number)`
  - `updateEntryOnServer(conn, entry, childServerId: number)`
  - `updateMeasurementOnServer(conn, m, childServerId: number)`

  Task 4 calls these.

- [ ] **Step 1: Add the parameter to all four functions**

Each gains a required trailing `childServerId: number` and passes it to the client call it wraps. `pushEntryToServer` becomes:

```ts
export async function pushEntryToServer(
  conn: Connection,
  entry: Entry,
  childServerId: number,
): Promise<number | undefined> {
  if (conn.mode !== 'server') return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createEntry(entry, childServerId);
}
```

Apply the same shape to the other three, leaving their existing guards and return types untouched.

- [ ] **Step 2: Fix the two direct-call files Task 2 surfaced**

The required parameter found call sites outside the repository layer, which is exactly what it is for. Both call the client directly and both must pass a real server id.

`src/api/client.test.ts` has 12 calls. These are unit tests against the client, so the child server id is just test data: pass a literal such as `1` (or whatever numeric child id that file already uses in its fixtures, if it has one, in which case reuse that for consistency). Read the file first and follow its existing conventions.

**Important for these tests:** several will assert on the request body sent to the server. Any assertion that expects `child` to equal a local id string is now asserting the bug and must be updated to expect the numeric server id you pass. Do not delete such a test; change its expectation. If any test's whole purpose was to prove `child` came from `entry.childId`, say so in your report rather than quietly dropping it.

`scripts/itest.ts` is a manual integration script run against a real Baby Buddy server with `BB_CHILD=<numeric id>` in the environment. It has 7 calls. It already reads that child id; pass it to each call. Read the file's top-of-file comment for how it obtains the id and reuse that value rather than introducing a new one.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

Expected: **errors again, still correct.** `src/data/repository.ts`, `src/api/client.test.ts` and `scripts/itest.ts` are now consistent, and the remaining errors have moved up to `src/store/useAppStore.ts` and its test file, which Task 4 owns. Confirm in your report that every remaining error is a missing-argument error at one of these four repository functions, and nothing else.

- [ ] **Step 4: Run the client tests**

Run: `npx vitest run src/api/client.test.ts`
Expected: PASS. Those 6 failures Task 2 left behind were signature mismatches, and Step 2 resolves them. If any still fail on an ASSERTION rather than a signature, that is a real behaviour question: report it rather than forcing the assertion to match.

- [ ] **Step 5: Commit**

```bash
git add src/data/repository.ts src/api/client.test.ts scripts/itest.ts
git commit -m "feat(ids): repository push and update take an explicit childServerId"
```

The tree still does not typecheck project-wide. Task 4 closes it.

---

### Task 4: Resolve the child at every store call site

The behavioural half. Each caller now has to find the owning child and decide what to do when it has no `serverId`.

**Files:**
- Modify: `src/store/useAppStore.ts` (`buildUploadDeps` ~line 374, `flushQueue` ~line 907, `commitWrite` ~line 1017, `saveMeasurement` ~line 1557, `updateEntryOnServer` caller ~line 1499)
- Modify: `src/data/sync.ts` (`UploadDeps` types and the two push loops)

**Interfaces:**
- Consumes: the Task 3 repository functions.
- Produces: `UploadDeps.pushEntry(entry: Entry, childServerId: number)` and `UploadDeps.pushMeasurement(m: Measurement, childServerId: number)`.

- [ ] **Step 1: Add a child-server-id resolver to the store**

Add beside the other module-level helpers in `src/store/useAppStore.ts`:

```ts
/** The server id of the child a record belongs to, or null when that child has
 *  never been pushed. A record whose child has no server id MUST NOT be sent:
 *  the server would reject it and the retry queue would replay it verbatim
 *  forever. Callers enqueue instead and let the reconnect flush handle it once
 *  the child exists server-side. */
function childServerIdFor(children: Child[], childId: string): number | null {
  return children.find((c) => c.id === childId)?.serverId ?? null;
}
```

- [ ] **Step 2: Update `buildUploadDeps` and the sync loops**

In `src/store/useAppStore.ts`, `buildUploadDeps` becomes:

```ts
    pushEntry: (e, childServerId) => pushEntryToServer(conn, e, childServerId),
    pushMeasurement: (m, childServerId) => pushMeasurementToServer(conn, m, childServerId),
```

In `src/data/sync.ts`, widen the `UploadDeps` type so both take the second argument:

```ts
  pushEntry: (entry: Entry, childServerId: number) => Promise<number | undefined>;
  pushMeasurement: (m: Measurement, childServerId: number) => Promise<number | undefined>;
```

Then change the two push loops to pass the server id explicitly instead of the copy trick. The entry loop's push line currently reads:

```ts
    const id = await tryPush(deps.pushEntry, { ...entry, childId: String(serverChildId) });
```

Change it to pass the unmodified entry plus the id:

```ts
    const id = await tryPush(deps.pushEntry, entry, serverChildId);
```

Do the same for the measurement loop. You will need to widen `tryPush` to forward the extra argument; read its current definition and add a second parameter rather than changing its error handling. The surrounding `childIdMap` lookups and the skip-when-unsynced behaviour stay exactly as they are: they were already correct.

- [ ] **Step 3: Update `commitWrite`**

At its `pushEntryToServer` call (~line 1017), resolve the child first and enqueue when there is no server id. Replace the push with:

```ts
      const childServerId = childServerIdFor(s.children, entry.childId);
      if (childServerId == null) {
        // The child is not on the server yet, so this entry cannot be either.
        // Queue it: the reconnect flush pushes it once the child exists.
        void enqueueEntry(entry);
      } else {
        void pushEntryToServer(conn, entry, childServerId)
```

keeping the existing `.then(...)`/`.catch(...)` chain attached to the `pushEntryToServer` call and closing the `else` after it. Read the surrounding code and match how it already enqueues on failure rather than inventing a new call; use the same enqueue function that the `.catch` uses.

- [ ] **Step 4: Update `saveMeasurement` and the entry-update path**

Apply the same resolve-then-branch shape at the `pushMeasurementToServer` call (~line 1557) and at the `updateEntryOnServer` call (~line 1499). For the update path, if the child has no server id there is nothing sensible to send, so skip the server call and leave the local edit in place, matching how those paths already behave when offline.

- [ ] **Step 5: Verify nothing sends a local id**

Run: `grep -rn "pushEntryToServer(\|pushMeasurementToServer(\|updateEntryOnServer(\|updateMeasurementOnServer(" src --include="*.ts" | grep -v "repository.ts"`

Read every line the grep prints and confirm each passes a resolved server id rather than an entry field. Put that list in your report.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`

Expected: `tsc` now exits 0, because this task closes the chain Tasks 2 and 3 opened. Tests may fail: existing tests mock `pushEntryToServer` with a two-argument signature and some assert on the old behaviour. Fix ONLY the mock signatures here so they accept the third argument. If a test fails on an assertion rather than a signature, leave it failing and list it in your report; Task 6 owns those.

- [ ] **Step 7: Commit**

```bash
git add src/store/useAppStore.ts src/data/sync.ts
git commit -m "feat(ids): resolve the child server id at every push site"
```

---

### Task 5: Stop re-keying, and reconcile instead

The deletion the whole plan exists for.

**Files:**
- Modify: `src/store/useAppStore.ts` (`saveChild`'s create branch ~lines 1112-1135, `hydrate` ~line 621, `refresh` ~line 684, `adopt`'s success path)

**Interfaces:**
- Consumes: `reconcileChildren` (Task 1).
- Produces: no new exports.

- [ ] **Step 1: Remove the re-key from `saveChild`**

In `saveChild`'s create branch the push callback currently rewrites the child's `id` and re-points `selectedChildId`. Replace the whole `set((st) => ({ ... }))` inside that `.then((res) => { ... })` with:

```ts
          // Stamp the server id and adopt the server's picture URL. The local
          // `id` is deliberately NOT rewritten: entries and measurements
          // reference it, and changing it would orphan them. Reconciliation
          // matches this child by `serverId` from here on.
          set((st) => ({
            children: st.children.map((c) =>
              c.id === localId ? { ...c, serverId: res.id, picture: res.picture ?? c.picture } : c,
            ),
          }));
```

Note what goes: the `id: String(res.id)` rewrite and the entire `selectedChildId` line. The long comment above the old block explained why the re-key was needed; it is now wrong and must be replaced by the comment above.

- [ ] **Step 2: Reconcile in `hydrate`**

`hydrate` currently has `children: mergeUnsynced(data.children, e?.children ?? []),`. Change it to:

```ts
        children: reconcileChildren(data.children, e?.children ?? []),
```

Leave the `measurements` line using `mergeUnsynced`. This task changes children only.

- [ ] **Step 3: Reconcile in `refresh`**

`refresh` has the same `mergeUnsynced` call for children. Change it the same way, to `reconcileChildren(data.children, <the local children it currently passes>)`. Read the surrounding lines and keep whatever local list it already passes as the second argument.

Then check the `selectedChildId` fallback that follows it. It must be validated against the RECONCILED list, not the raw server list. If it currently checks against `data.children`, change it to check the reconciled result, so a selected local child is not silently dropped.

- [ ] **Step 4: Reconcile in `adopt`**

`adopt`'s success path replaces state from `loadFromServer`. Apply the same treatment: reconcile children rather than taking the server list wholesale, and validate `selectedChildId` against the reconciled list. Read how Step 3 ended up and mirror it.

- [ ] **Step 5: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`

Expected: `tsc` and lint clean. Tests WILL fail here, and that is the point: any test asserting a child's id changed after a push is now asserting the bug. List every failing test in your report with its name and what it asserts. Do NOT fix them here; Task 6 owns that and needs the list.

- [ ] **Step 6: Commit**

```bash
git add src/store/useAppStore.ts
git commit -m "feat(ids): stop re-keying children, reconcile by serverId"
```

---

### Task 6: Invert the tests that pinned the old behaviour, and pin the new one

**Files:**
- Modify: `src/store/useAppStore.test.ts`
- Modify: `src/data/sync.test.ts` if it also asserts on re-keying

**Interfaces:**
- Consumes: everything above.
- Produces: no new exports.

- [ ] **Step 1: Invert, do not delete**

Take the failing-test list from Task 5. For each test that asserts a child's `id` became the server id after a push, invert the assertion so it asserts the id is UNCHANGED and that `serverId` was stamped. Keep the test's name accurate to what it now checks.

Do NOT delete these tests. They are the ones that pin the invariant; deleting them is how it would silently regress later. If a test is genuinely obsolete rather than inverted (it tests something that no longer exists at all), say so explicitly in your report with your reasoning, and only then remove it.

- [ ] **Step 2: Add the load-bearing regression test**

This is the test the codebase has never had, and it is the one that would have caught the entire bug class. Add to `src/store/useAppStore.test.ts`, following the file's existing server-mode harness style:

```ts
it('an entry created before its child was pushed still resolves to that child after a refresh', async () => {
  // Server mode, online. Create a child locally, log an entry against it, let
  // the child push, then refresh. The entry must still point at a child that
  // exists. This is the regression test for the whole orphaning class.
  useAppStore.setState({
    children: [],
    entries: [],
    selectedChildId: '',
    connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
    offline: false,
  });

  useAppStore.getState().saveChild({ first: 'Ada', last: '', birth: Date.parse('2026-01-01') });
  const localId = useAppStore.getState().children[0].id;

  // Let the push settle so serverId is stamped.
  await new Promise((r) => setTimeout(r, 0));

  const child = useAppStore.getState().children.find((c) => c.id === localId);
  expect(child?.id).toBe(localId); // id must NOT have been rewritten
  expect(child?.serverId).toBeDefined();

  // An entry logged against the local id.
  useAppStore.setState((st) => ({
    entries: [...st.entries, { id: 'e1', childId: localId, type: 'note', time: Date.now(), text: 'hi', tags: [] } as Entry],
  }));

  await useAppStore.getState().refresh();

  const entry = useAppStore.getState().entries.find((e) => e.id === 'e1');
  const owner = useAppStore.getState().children.find((c) => c.id === entry?.childId);
  expect(owner).toBeDefined(); // the entry is not orphaned
  expect(owner?.id).toBe(localId);
});
```

Read the file's existing server-mode tests first and match how they stub `loadFromServer` so the refresh returns the pushed child. If the harness shape differs from the sketch above, follow the harness rather than the sketch; the assertions are what matter.

- [ ] **Step 3: Add the enqueue-instead-of-push test**

```ts
it('an entry whose child has no serverId is queued, not pushed', async () => {
  useAppStore.setState({
    children: [{ id: 'localA', first: 'Ada', last: '', birth: Date.parse('2026-01-01'), color: '#E8A87C' }],
    entries: [],
    selectedChildId: 'localA',
    connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
    offline: false,
  });

  // Log an entry through whatever action the file's other entry tests use.
  // Assert the harness recorded NO entry push, and that the queue grew.
});
```

To fill the body: the test file defines a mock harness object (the one whose `childPushed` array the child-push tests assert on, declared near the top of the file with the `vi.mock` block around lines 141-152). It has an equivalent array for entry pushes. Find it, then use the same entry-logging action the file's other entry tests call. The two assertions are: that array stays empty, and the queue count grows.

- [ ] **Step 3b: Add the selectedChildId test**

Removing the `selectedChildId` re-point is a deliberate deletion, so pin that it still lands somewhere real:

```ts
it('selectedChildId still points at a real child after a push and a refresh', async () => {
  useAppStore.setState({
    children: [],
    selectedChildId: '',
    connection: { mode: 'server', serverUrl: 'http://x', token: 't' },
    offline: false,
  });

  useAppStore.getState().saveChild({ first: 'Ada', last: '', birth: Date.parse('2026-01-01') });
  const localId = useAppStore.getState().children[0].id;
  expect(useAppStore.getState().selectedChildId).toBe(localId);

  await new Promise((r) => setTimeout(r, 0));
  await useAppStore.getState().refresh();

  const sel = useAppStore.getState().selectedChildId;
  expect(useAppStore.getState().children.some((c) => c.id === sel)).toBe(true);
  expect(sel).toBe(localId); // selection follows the stable id, not the server id
});
```

Match the file's `loadFromServer` stubbing the same way Step 2 does.

- [ ] **Step 4: Prove the new tests bite**

Temporarily revert Step 1 of Task 5 (put the `id: String(res.id)` rewrite back), re-run, and confirm the Step 2 test FAILS. Restore, and confirm `git diff src/store/useAppStore.ts` is empty. Put that output in your report. A test that passes either way is not testing anything.

- [ ] **Step 5: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: all clean, all green.

- [ ] **Step 6: Commit**

```bash
git add src/store/useAppStore.test.ts src/data/sync.test.ts
git commit -m "test(ids): pin stable ids, invert the tests that asserted re-keying"
```

---

### Task 7: Drive it on web

**Files:** none modified. This verifies Tasks 1 to 6.

- [ ] **Step 1: Start the web build with a cleared cache**

Run: `CI=1 npx expo start --web --port 8081 --clear`

`--clear` is REQUIRED. Metro's on-disk cache survives a plain restart and will serve stale modules, which has previously produced a full round of phantom failures against correct code.

- [ ] **Step 2: Drive local mode end to end**

Headless Playwright, Chromium with `--no-sandbox`, and neutralise the dev-only LogBox overlay first:

```js
await page.addStyleTag({ content: '#error-toast{display:none !important;pointer-events:none !important;}' });
```

From a fresh browser context: complete onboarding in local mode, add a child, log a feed and a nap, and confirm both appear in History. Local mode never pushes, so this is the regression check that the refactor did not break ordinary use.

- [ ] **Step 3: Confirm no render loop and no console errors**

Assert no "Maximum update depth exceeded" in any scenario. Ignore the known pre-existing "React does not recognize the `%s` prop" warning.

- [ ] **Step 4: Commit anything the run turned up**

If the run required fixes, commit them against the task they belong to. If not, the branch is ready.

---

## Notes for the implementer

- **The invariant is the whole point.** If you find yourself writing code that changes a stored `id`, stop: that is the bug this plan removes.
- **Remap for the payload, never in state.** `uploadUnsynced` already models this correctly.
- **A record whose child has no `serverId` must be queued, not pushed.** Pushing it produces a server rejection and a queue entry that retries verbatim forever.
- **Tasks 2 and 3 deliberately leave the tree not typechecking.** That is the required-parameter change propagating, and Task 4 closes it. Do not paper over it with default values.
- **Out of scope:** stable ids for entries and measurements. They are re-keyed too, by wholesale replacement on refresh, but nothing references them by id so no orphaning is reachable. The spec records this decision.
- **Also out of scope here:** the six reproduced failures listed in `docs/superpowers/specs/2026-07-19-mutating-child-ids-findings.md`. Five of them need the expecting-child feature to reproduce, and that feature is not on this branch. They belong to the rebase of `expecting-child-state` onto this work, not to this plan. The two tests added in Task 6 are the branch-local equivalents: they pin the invariant those six failures all violated.
